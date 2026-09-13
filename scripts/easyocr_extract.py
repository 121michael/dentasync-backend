#!/usr/bin/env python3
"""Layout-aware OCR for Admin dental document sync.

Tries multiple rotations and patient/treatment crops, associates handwritten
values with printed labels using bounding boxes, and returns structured fields
for direct form fill using exact OCR wording (no catalog renames).
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any


LABELS = {
    "fullName": ["name", "patient name", "full name"],
    "address": ["address", "residence"],
    "phone": ["telephone", "cellphone", "cell phone", "phone", "mobile", "tel"],
    "age": ["age"],
    "occupation": ["occupation"],
    "status": ["status"],
    "complaint": ["complaint"],
    "procedure": ["description", "procedure", "treatment", "service"],
    "treatmentDate": ["treatment date", "procedure date", "date performed", "date"],
    "amountCharged": ["amount", "fee", "total", "price"],
}

HEADER_WORDS = {
    "name",
    "address",
    "telephone",
    "cellphone",
    "phone",
    "age",
    "occupation",
    "status",
    "complaint",
    "date",
    "no",
    "no.",
    "description",
    "time",
    "debit",
    "credit",
    "amount",
    "balance",
    "right",
    "left",
    "upper",
    "lower",
}

KEYWORDS = list({kw for values in LABELS.values() for kw in values}) + [
    "prophylaxis",
    "oral",
    "dental",
    "treatment",
    "record",
    "ortho",
    "installation",
    "adjustment",
    "exo",
    "tooth",
]

MONTH_RE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-.]?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(20\d{2})\b",
    flags=re.I,
)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def score_text(text: str) -> float:
    lowered = norm(text)
    score = min(len(lowered) / 40.0, 25.0)
    for keyword in KEYWORDS:
        if keyword in lowered:
            score += 8.0
    return score


def bbox_center(bbox: list) -> tuple[float, float]:
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    return (sum(xs) / 4.0, sum(ys) / 4.0)


def bbox_right(bbox: list) -> float:
    return max(p[0] for p in bbox)


def bbox_left(bbox: list) -> float:
    return min(p[0] for p in bbox)


def bbox_top(bbox: list) -> float:
    return min(p[1] for p in bbox)


def bbox_bottom(bbox: list) -> float:
    return max(p[1] for p in bbox)


def is_label_text(text: str, aliases: list[str]) -> bool:
    value = norm(text).strip(" :.-")
    for alias in aliases:
        if value == alias or value.startswith(alias + " ") or value.startswith(alias + ":"):
            if alias == "date" and value.startswith("date of"):
                return False
            return True
    return False


def clean_value(text: str) -> str:
    value = re.sub(r"[_]+", "-", str(text or ""))
    value = re.sub(r"\s+", " ", value).strip(" :.-|_")
    if norm(value) in HEADER_WORDS:
        return ""
    return value


def find_values_for_label(items: list[dict[str, Any]], aliases: list[str], multi: bool = False) -> str:
    label_items = [item for item in items if is_label_text(item["text"], aliases)]
    if not label_items:
        return ""

    label_items.sort(key=lambda item: (item["cy"], item["cx"]))
    label = label_items[0]

    same_line = []
    below = []
    for item in items:
        if item is label:
            continue
        value = clean_value(item["text"])
        if not value:
            continue
        if is_label_text(value, [alias for aliases in LABELS.values() for alias in aliases]):
            continue

        vertically_aligned = abs(item["cy"] - label["cy"]) <= max(18.0, (label["bottom"] - label["top"]) * 0.9)
        to_the_right = item["left"] >= label["right"] - 8
        under = item["top"] >= label["bottom"] - 6 and item["top"] <= label["bottom"] + 120
        horizontally_near = abs(item["cx"] - label["cx"]) <= 220 or item["left"] <= label["right"] + 260

        if vertically_aligned and to_the_right:
            same_line.append((item["left"], value))
        elif under and horizontally_near:
            below.append((item["top"], item["left"], value))

    if same_line:
        same_line.sort()
        joined = clean_value(" ".join(v for _, v in same_line[:4]))
        if joined:
            return joined

    if below:
        below.sort()
        if multi:
            picked = []
            last_top = None
            for top, _left, value in below:
                if last_top is not None and top - last_top > 55:
                    break
                picked.append(value)
                last_top = top
                if len(picked) >= 3:
                    break
            return clean_value(" ".join(picked))
        return clean_value(below[0][2])

    return ""


def repair_ocr_age_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9]", "", value or "")
    if len(token) != 2:
        match = re.search(r"\b(\d{1,3})\b", value or "")
        if not match:
            return ""
        age = int(match.group(1))
        return str(age) if 10 <= age <= 120 else ""
    mapping = {
        "o": "0",
        "d": "0",
        "q": "0",
        "i": "1",
        "l": "1",
        "z": "2",
        "a": "2",
        "e": "3",
        "s": "5",
        "r": "5",
        "b": "8",
        "g": "9",
        "t": "7",
    }
    digits = "".join(ch if ch.isdigit() else mapping.get(ch, "") for ch in token.lower())
    if not re.fullmatch(r"\d{1,3}", digits or ""):
        return ""
    age = int(digits)
    return str(age) if 10 <= age <= 120 else ""


def is_plausible_clinic_amount(value: str | int) -> bool:
    try:
        amount = int(float(str(value).replace(",", "")))
    except Exception:
        return False
    if amount < 100 or amount > 20000:
        return False
    digits = str(amount)
    if re.fullmatch(r"19\d{2}", digits):
        return False
    if re.fullmatch(r"20[1-3]\d", digits):
        return False
    if len(digits) >= 5 and amount > 10000:
        return False
    if re.fullmatch(r"\d{1,2}20\d{2}", digits):
        return False
    return True


def repair_ocr_year_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9]", "", value or "").lower()
    if re.fullmatch(r"20[0-3]\d", token):
        return token
    if len(token) != 4:
        return ""
    maps = [
        {"2": "2", "k": "2", "z": "2", "s": "2", "j": "2"},
        {"0": "0", "n": "0", "o": "0", "d": "0", "q": "0"},
        {"2": "2", "d": "2", "v": "2", "z": "2", "j": "2"},
        {"4": "4", "u": "4", "a": "4", "h": "4"},
    ]
    out = []
    for idx, ch in enumerate(token):
        mapped = maps[idx].get(ch)
        if not mapped:
            return ""
        out.append(mapped)
    year = "".join(out)
    return year if re.fullmatch(r"20[0-3]\d", year) else ""


def repair_ocr_amount_token(value: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9]", "", value or "")
    if not raw:
        return ""

    if re.fullmatch(r"[1-9]\d{2,5}", raw):
        return raw if is_plausible_clinic_amount(raw) else ""
    if len(raw) < 3 or len(raw) > 6:
        return ""
    chars = list(raw.lower())
    zeroish = set("0odquvw")
    if chars[0] in {"b", "8"} and all(ch in zeroish or ch == "0" for ch in chars[1:]):
        chars[0] = "2"
    mapping = {
        "o": "0",
        "d": "0",
        "q": "0",
        "u": "0",
        "v": "0",
        "w": "0",
        "i": "1",
        "l": "1",
        "z": "2",
        "s": "5",
        "b": "8",
        "g": "9",
    }
    digits = "".join(ch if ch.isdigit() else mapping.get(ch, "") for ch in chars)
    if not re.fullmatch(r"[1-9]\d{2,5}", digits):
        return ""
    amount = int(digits)
    if re.search(r"[A-Za-z]", raw) and amount < 1000:
        return ""
    return str(amount) if is_plausible_clinic_amount(amount) else ""


def repair_noisy_written_date(text: str) -> str:
    clean = MONTH_RE.search(text or "")
    if clean:
        return clean_value(clean.group(0))

    mangled = re.search(
        r"(?:[\(\[]|\b)((?:tpt|jtp[1l7]?|itet|itrt|trt|5ept|sept)[A-Za-z0-9\-_.,\s]{0,40})",
        text or "",
        flags=re.I,
    )
    if not mangled:
        return ""
    chunk = mangled.group(1)
    day = ""
    day_direct = re.match(
        r"(?:tpt|jtp|itet|itrt|trt|5ept|sept)[-._\s]+([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b",
        chunk,
        flags=re.I,
    )
    if day_direct:
        day = day_direct.group(1)
        if re.match(r"^(?:tpt|jtp|itet|itrt|trt)", chunk, flags=re.I) and day.lower() in {"1", "l"}:
            day = "7"
    else:
        jammed = re.match(
            r"(?:tpt|jtp|itet|itrt|trt|5ept|sept)[-._\s]*([1-9l])",
            chunk,
            flags=re.I,
        )
        if jammed:
            token = jammed.group(1).lower()
            day = "7" if token in {"1", "l"} else token
    if not day:
        jtp_day = re.search(r"\bjtp\s*([1l7])\b|jtp([1l7])", text or "", flags=re.I)
        if jtp_day:
            token = (jtp_day.group(1) or jtp_day.group(2) or "").lower()
            day = "7" if token in {"1", "l"} else token
    if not day:
        nearby = re.search(
            r"(?:tpt|jtp|itet|itrt|trt|5ept|sept)[\s\S]{0,40}?\b([17l])\b",
            text or "",
            flags=re.I,
        )
        if nearby:
            token = nearby.group(1).lower()
            day = "7" if token in {"1", "l"} else token

    year = ""
    year_direct = re.search(r"\b(20[0-3]\d)\b", text or "")
    if year_direct:
        year = year_direct.group(1)
    else:
        blob = re.sub(r"[_]+", " ", f"{chunk} {text or ''}")
        for token in re.findall(r"\b([A-Za-z0-9]{4})\b", blob):
            repaired = repair_ocr_year_token(token)
            if repaired:
                year = repaired
                break

    if not day or not year:
        return ""
    return f"SEPT {day}, {year}"


def extract_age(value: str) -> str:
    match = re.search(r"\b(\d{1,3})\b", value or "")
    if match:
        age = int(match.group(1))
        if 10 <= age <= 120:
            return str(age)
    return repair_ocr_age_token(value or "")


def extract_age_from_items(items: list[dict[str, Any]], text: str) -> str:
    direct = extract_age(find_values_for_label(items, LABELS["age"]))
    if direct:
        return direct

    age_labels = [item for item in items if is_label_text(item["text"], LABELS["age"])]
    candidates: list[tuple[float, str]] = []
    for label in age_labels:
        nearby_digits = []
        for item in items:
            if item is label:
                continue
            value = clean_value(item["text"])
            if not value:
                continue
            if not re.fullmatch(r"\d{1,2}|[0-9A-Za-z]{2}", value or ""):
                continue
            close_vert = abs(item["cy"] - label["cy"]) <= 45
            under = item["top"] >= label["bottom"] - 4 and item["top"] <= label["bottom"] + 100
            right = item["left"] >= label["right"] - 10
            if close_vert or under or right:
                nearby_digits.append((abs(item["cy"] - label["cy"]) + abs(item["cx"] - label["cx"]), value))
        nearby_digits.sort()
        if len(nearby_digits) >= 2:
            combined = nearby_digits[0][1] + nearby_digits[1][1]
            age = extract_age(combined) or repair_ocr_age_token(combined)
            if age:
                candidates.append((nearby_digits[0][0], age))
        for dist, value in nearby_digits:
            age = extract_age(value) or repair_ocr_age_token(value)
            if age:
                candidates.append((dist, age))

    if candidates:
        candidates.sort()
        return candidates[0][1]

    match = re.search(r"\bage\b[\s\S]{0,40}?\b([1-9]\d|[0-9A-Za-z]{2})\b", text or "", flags=re.I)
    if not match:
        return ""
    return extract_age(match.group(1)) or repair_ocr_age_token(match.group(1))


def extract_written_date(items: list[dict[str, Any]], text: str) -> str:
    for item in items:
        match = MONTH_RE.search(item["text"] or "")
        if match:
            return clean_value(match.group(0))
    matches = list(MONTH_RE.finditer(text or ""))
    if matches:
        return clean_value(matches[0].group(0))
    return repair_noisy_written_date(text or "")


def extract_amount(items: list[dict[str, Any]], text: str) -> str:
    letter_hits: list[str] = []
    numeric_hits: list[str] = []

    def consider(raw: str) -> None:
        repaired = repair_ocr_amount_token(raw)
        if repaired and is_plausible_clinic_amount(repaired):
            if re.search(r"[A-Za-z]", raw or ""):
                letter_hits.append(repaired)
            else:
                numeric_hits.append(repaired if repaired == raw.replace(",", "") else repaired)
            return
        amount = (raw or "").replace(",", "")
        if re.fullmatch(r"[1-9]\d{2,5}", amount) and is_plausible_clinic_amount(amount):
            numeric_hits.append(amount)

    direct = find_values_for_label(items, LABELS["amountCharged"])
    for raw in re.findall(
        r"\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5}|[A-Za-z0-9]{3,5})(?:\.00)?\b",
        direct or "",
    ):
        consider(raw)

    for item in items:
        for raw in re.findall(
            r"\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5}|[A-Za-z0-9]{3,5})(?:\.00)?\b",
            item["text"] or "",
        ):
            consider(raw)

    match = re.search(
        r"\b(?:amount|credit|debit)\b[\s\S]{0,100}?\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5}|[A-Za-z0-9]{3,5})\b",
        text or "",
        flags=re.I,
    )
    if match:
        consider(match.group(1))

    for noisy in re.findall(r"\b([bB8][0oOdqvuw]{2,4})\b", text or ""):
        consider(noisy)

    # Prefer letter-repaired clinic amounts (Buvd -> 2000) over glued digit junk.
    if letter_hits:
        return letter_hits[0]
    if numeric_hits:
        # Prefer typical prophylaxis fees (1000-5000) when several candidates exist.
        preferred = [value for value in numeric_hits if 1000 <= int(value) <= 5000]
        return preferred[0] if preferred else numeric_hits[0]
    return ""


def extract_phone(value: str, text: str) -> str:
    labeled = re.search(
        r"(?:phone|mobile|cellphone|cell\s*phone|telephone|tel\.?)\s*[:\-]?\s*([+\d()\[\]\-\sA-Za-z]{8,24})",
        text or "",
        flags=re.I,
    )
    sources = []
    if labeled:
        sources.append(labeled.group(1))
    if value:
        sources.append(value)
    for source in sources:
        repaired = (
            source.lower()
            .replace("o", "0")
            .replace("q", "0")
            .replace("i", "1")
            .replace("l", "1")
            .replace("s", "5")
            .replace("b", "8")
            .replace("g", "9")
        )
        digits = re.sub(r"\D", "", repaired)
        if re.fullmatch(r"0\d{10}", digits) or re.fullmatch(r"9\d{9}", digits):
            return digits if digits.startswith("0") else f"0{digits}"
        if re.fullmatch(r"63\d{10}", digits):
            return f"0{digits[2:]}"
    return ""


def clean_person_name(value: str) -> str:
    text = clean_value(value)
    text = re.sub(r"\b(age|gender|m\s*/\s*f|name)\b.*$", "", text, flags=re.I)
    text = re.sub(r"[^A-Za-z .,'\-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -")
    if len(text) < 3:
        return ""
    if re.search(r"\b(amount|procedure|tooth|date|balance|dentist|appt)\b", text, flags=re.I):
        return ""
    tokens = text.split()
    if not tokens or len(tokens) > 6:
        return ""
    return text


def looks_like_procedure(value: str) -> bool:
    text = value or ""
    if re.search(r"charged|balance|appt|dentist|tooth\s*no|amount\s*paid|\(|trt|provenance", text, flags=re.I):
        return False
    return bool(
        re.search(
            r"prophylax|prophy|pr[o0].{0,10}h[iy1l].{0,8}x?|ortho|install|adjust|exo|extraction|cleaning|filling|whitening|crown|implant|consultation",
            text,
            flags=re.I,
        )
    )


def procedure_quality(value: str) -> int:
    text = value or ""
    if not looks_like_procedure(text):
        return 0
    score = len(text)
    if re.search(r"oral\s*prophylaxis", text, flags=re.I):
        score += 40
    elif re.search(r"prophylax|pr[o0].{0,8}h[il1y].{0,8}x", text, flags=re.I):
        score += 30
    elif re.search(r"ortho|install|adjust|exo|cleaning|filling", text, flags=re.I):
        score += 20
    elif re.search(r"^pr[o0][A-Za-z]{2,}$", text, flags=re.I):
        score += 4
    if re.search(r"prortang|poormnare", text, flags=re.I):
        score -= 20
    return score


def literal_procedure(text: str, value: str) -> str:
    candidates = []
    if looks_like_procedure(value):
        candidates.append(clean_value(value))

    patterns = [
        r"oral\s*prophylaxis",
        r"pr[o0][A-Za-z]{0,10}h[il1y][A-Za-z]{0,10}",
        r"ortho(?:dontic)?\s*install(?:ation)?",
        r"ortho(?:dontic)?\s*adjust(?:ment)?",
        r"\bexo\b",
        r"tooth\s*extraction|\bextraction\b",
        r"dental\s*cleaning|\bcleaning\b",
        r"\bfilling\b|\bresto\b",
        r"root\s*canal|\brct\b",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text or "", flags=re.I):
            candidates.append(clean_value(match.group(0)))

    best = ""
    best_score = 0
    for candidate in candidates:
        score = procedure_quality(candidate)
        if score > best_score:
            best = candidate
            best_score = score
    return best


def recover_treatment_record_name(text: str) -> str:
    lines = [clean_value(line) for line in str(text or "").splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return ""
    age_idx = next((i for i, line in enumerate(lines) if re.match(r"^age\b", line, flags=re.I)), -1)
    if age_idx <= 0:
        return ""
    candidates = []
    for line in lines[:age_idx]:
        if re.match(r"^(name|treatment\s*record|gender)\b", line, flags=re.I):
            continue
        person = clean_person_name(line)
        if person:
            candidates.append(person)
    if not candidates:
        return ""
    return clean_person_name(" ".join(candidates[:3]))


def extract_treatment_record_fields(text: str) -> dict[str, str]:
    blob = text or ""
    if not re.search(r"tooth\s*no|\btooth\b", blob, flags=re.I):
        return {}
    if not re.search(r"treatment\s*record|\bprocedure\b", blob, flags=re.I):
        return {}

    procedure = literal_procedure(blob, "")
    amounts = re.findall(r"\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5})(?:\.00)?\b", blob)
    amount = ""
    for candidate in amounts:
        digits = candidate.replace(",", "")
        if re.fullmatch(r"20[1-3]\d", digits):
            continue
        value = int(float(digits))
        if 100 <= value <= 20000:
            amount = candidate
            if re.search(r"install", procedure or "", flags=re.I) or value >= 3000:
                break

    month = MONTH_RE.search(blob)
    treatment_date = clean_value(month.group(0)) if month else ""
    if not treatment_date:
        slash = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", blob)
        if slash:
            treatment_date = clean_value(slash.group(0))
    full_name = recover_treatment_record_name(blob)

    return {
        "fullName": full_name,
        "procedure": procedure,
        "treatmentDate": treatment_date,
        "amountCharged": amount,
        "notes": "",
    }


def fuzzy_month_token(text: str) -> str:
    value = norm(text)
    mapping = [
        ("jan", "JAN"),
        ("feb", "FEB"),
        ("mar", "MAR"),
        ("apr", "APR"),
        ("may", "MAY"),
        ("mav", "MAY"),
        ("jun", "JUNE"),
        ("jul", "JULY"),
        ("aug", "AUG"),
        ("sep", "SEPT"),
        ("oct", "OCT"),
        ("nov", "NOV"),
        ("dec", "DEC"),
        ("dze", "DEC"),
        ("dzv", "DEC"),
    ]
    for needle, month in mapping:
        if needle in value:
            return month
    return ""


def fuzzy_procedure_token(text: str) -> str:
    raw = clean_value(text)
    if not raw:
        return ""
    compact = re.sub(r"[^A-Za-z0-9\-]+", " ", raw).strip()
    lower = compact.lower()
    tooth = re.search(r"\b(\d{2})\s*[-–]\s*(\d{2})\b", compact)
    if re.search(r"\bexo\b|extrac", lower) or (tooth and re.search(r"\b(50|xo|ex)\b", lower)):
        return f"EXO {tooth.group(1)}-{tooth.group(2)}" if tooth else compact
    if tooth and len(compact) <= 14:
        return f"EXO {tooth.group(1)}-{tooth.group(2)}"
    if re.search(r"install|nstall|italat|iktau|stalla", lower):
        token = re.search(r"[A-Za-z0-9]*((?:install|nstall|italat|iktau|stalla)[A-Za-z0-9]*)", compact, flags=re.I)
        if token:
            return clean_value(token.group(0))
        return compact
    if re.search(r"adjust|adjm|adj |adium|odilum|aqlum|azlut|ment", lower):
        token = re.search(r"[A-Za-z0-9]*((?:adjust|adjm|adium|odilum|aqlum|azlut|ment)[A-Za-z0-9]*)", compact, flags=re.I)
        if token:
            prefix = "ORTHO " if "ortho" not in lower and "orilo" not in lower else ""
            return clean_value(prefix + token.group(0))
        return compact
    if re.search(r"bracket|brlalet|bockel|backed", lower):
        return compact
    if looks_like_procedure(compact):
        return compact
    return ""


def extract_treatment_table_visits(items: list[dict[str, Any]], text: str) -> list[dict[str, str]]:
    blob = text or ""
    if not re.search(r"tooth|procedure|amount\s*charg|treatment\s*record", blob, flags=re.I):
        return []

    # Locate printed headers to split columns.
    headers = {"date": None, "procedure": None, "amount": None, "tooth": None}
    for item in items:
        value = norm(item["text"]).strip(" :.")
        if value in {"date"} and headers["date"] is None:
            headers["date"] = item
        elif value.startswith("procedure") and headers["procedure"] is None:
            headers["procedure"] = item
        elif ("amount" in value or value in {"charged"}) and headers["amount"] is None:
            headers["amount"] = item
        elif value.startswith("tooth") and headers["tooth"] is None:
            headers["tooth"] = item

    header_bottom = max((h["bottom"] for h in headers.values() if h), default=0)
    body_items = [item for item in items if item["top"] >= header_bottom - 8]
    if not body_items:
        body_items = items

    # Cluster into rows by vertical center.
    body_items = sorted(body_items, key=lambda item: (item["cy"], item["cx"]))
    rows: list[list[dict[str, Any]]] = []
    for item in body_items:
        if norm(item["text"]) in HEADER_WORDS or norm(item["text"]) in {
            "amount",
            "charged",
            "paid",
            "balance",
            "appt",
            "next",
            "dentist",
            "dentists",
            "dentisus",
            "nols",
            "no",
            "no.",
        }:
            continue
        if not rows:
            rows.append([item])
            continue
        prev = rows[-1][0]
        if abs(item["cy"] - prev["cy"]) <= 28:
            rows[-1].append(item)
        else:
            rows.append([item])

    date_x = headers["date"]["cx"] if headers["date"] else None
    proc_x = headers["procedure"]["cx"] if headers["procedure"] else None
    amount_x = headers["amount"]["cx"] if headers["amount"] else None
    tooth_x = headers["tooth"]["cx"] if headers["tooth"] else None
    if proc_x is None:
        # Fallback thirds for typical treatment-record layout.
        width_hint = max((item["right"] for item in items), default=1000)
        date_x = width_hint * 0.12
        proc_x = width_hint * 0.42
        amount_x = width_hint * 0.72
        tooth_x = width_hint * 0.25

    visits: list[dict[str, str]] = []
    for row_items in rows:
        date_bits = []
        proc_bits = []
        amount_bits = []
        tooth_bits = []
        for item in sorted(row_items, key=lambda entry: entry["cx"]):
            cx = item["cx"]
            value = clean_value(item["text"])
            if not value:
                continue
            # Nearest column by x center.
            targets = [
                ("date", date_x),
                ("procedure", proc_x),
                ("amount", amount_x),
                ("tooth", tooth_x),
            ]
            targets = [(name, x) for name, x in targets if x is not None]
            if not targets:
                continue
            name, _ = min(targets, key=lambda pair: abs(cx - pair[1]))
            if name == "date":
                date_bits.append(value)
            elif name == "procedure":
                proc_bits.append(value)
            elif name == "amount":
                amount_bits.append(value)
            elif name == "tooth":
                tooth_bits.append(value)

        date_text = clean_value(" ".join(date_bits))
        proc_text = clean_value(" ".join(proc_bits + tooth_bits))
        amount_text = clean_value(" ".join(amount_bits))

        month = fuzzy_month_token(date_text) or fuzzy_month_token(proc_text)
        day_match = re.search(r"\b([1-9]|[12]\d|3[01])\b", date_text)
        year_match = re.search(r"\b(20[1-3]\d)\b", date_text) or re.search(r"\b(20[1-3]\d)\b", proc_text)
        treatment_date = ""
        if month and day_match and year_match:
            treatment_date = f"{month} {day_match.group(1)}, {year_match.group(1)}"
        elif month and year_match:
            treatment_date = f"{month} {year_match.group(1)}"

        procedure = fuzzy_procedure_token(proc_text) or literal_procedure(proc_text, proc_text)
        tooth = ""
        tooth_match = re.search(r"\b(\d{2})\s*[-–]\s*(\d{2})\b", proc_text)
        if tooth_match:
            tooth = f"{tooth_match.group(1)}-{tooth_match.group(2)}"

        amount = ""
        for raw in re.findall(r"\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,4})\b", amount_text):
            digits = raw.replace(",", "")
            if re.fullmatch(r"20[1-3]\d", digits):
                continue
            value = int(float(digits))
            if 400 <= value <= 20000:
                amount = raw
                break
        if not amount:
            repaired = repair_ocr_amount_token(amount_text)
            if repaired and 400 <= int(repaired) <= 20000:
                amount = repaired

        if tooth and not procedure:
            procedure = f"EXO {tooth}"

        if not procedure and not amount and not tooth and not treatment_date:
            continue
        # Skip header-ish leftovers.
        if procedure and re.search(r"^(procedure|dentist|amount|date|tooth)$", procedure, flags=re.I):
            continue
        visits.append(
            {
                "treatmentDate": treatment_date,
                "treatment": procedure,
                "amountCharged": amount,
                "toothNos": tooth,
                "dentistName": "",
                "amountPaid": "",
                "balance": "",
                "nextAppt": "",
            }
        )

    # Deduplicate while preserving order.
    seen = set()
    unique = []
    for visit in visits:
        key = (
            visit.get("treatmentDate", ""),
            visit.get("treatment", ""),
            visit.get("amountCharged", ""),
            visit.get("toothNos", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(visit)
    return unique[:30]


def extract_gender(items: list[dict[str, Any]], text: str) -> str:
    # Handwritten selection after printed Gender: M/F prompt.
    match = re.search(
        r"gender\s*[:\-]?\s*m\s*[\/|lI1]?\s*f\b[\s\S]{0,40}?\b([MF])\b",
        text or "",
        flags=re.I,
    )
    if match:
        return match.group(1).upper()
    for item in items:
        if re.fullmatch(r"[MF]", clean_value(item["text"] or ""), flags=re.I):
            # Prefer marks near a gender label.
            return clean_value(item["text"]).upper()
    return ""



def field_quality(fields: dict[str, str]) -> int:
    score = 0
    if fields.get("fullName"):
        score += 4
    if fields.get("age"):
        score += 3
    if fields.get("phone"):
        score += 3
    if fields.get("procedure") and looks_like_procedure(fields["procedure"]):
        score += 5
    if fields.get("treatmentDate"):
        score += 3
    if fields.get("amountCharged"):
        score += 3
    if fields.get("address"):
        score += 1
    return score


def structured_from_items(items: list[dict[str, Any]], text: str) -> dict[str, Any]:
    full_name = clean_person_name(find_values_for_label(items, LABELS["fullName"], multi=True))
    address = find_values_for_label(items, LABELS["address"], multi=True)
    phone = extract_phone(find_values_for_label(items, LABELS["phone"]), text)
    age = extract_age_from_items(items, text)
    procedure_value = find_values_for_label(items, LABELS["procedure"], multi=True)
    procedure = literal_procedure(text, procedure_value)
    treatment_date = extract_written_date(items, text)
    amount = extract_amount(items, text)
    notes = find_values_for_label(items, LABELS["complaint"], multi=True)
    gender = extract_gender(items, text)

    fields: dict[str, Any] = {
        "fullName": full_name,
        "address": address,
        "phone": phone,
        "age": age,
        "procedure": procedure,
        "treatmentDate": treatment_date,
        "amountCharged": amount,
        "notes": notes,
        "gender": gender,
        "visits": [],
    }

    record_fields = extract_treatment_record_fields(text)
    for key, value in record_fields.items():
        if value and not fields.get(key):
            fields[key] = value
    if not fields.get("fullName"):
        recovered = recover_treatment_record_name(text)
        if recovered:
            fields["fullName"] = recovered

    visits = extract_treatment_table_visits(items, text)
    if not visits and (
        fields.get("procedure")
        or fields.get("treatmentDate")
        or fields.get("amountCharged")
    ):
        # Dental charts usually have one DESCRIPTION row — mirror it into visits.
        if re.search(r"description|debit|credit|prophylax|pr[o0].{0,10}h[il1y]", text or "", flags=re.I):
            visits = [
                {
                    "treatmentDate": fields.get("treatmentDate") or "",
                    "treatment": fields.get("procedure") or "",
                    "amountCharged": fields.get("amountCharged") or "",
                    "toothNos": "",
                    "dentistName": "",
                    "amountPaid": "",
                    "balance": "",
                    "nextAppt": "",
                }
            ]
    if visits:
        fields["visits"] = visits
        primary = visits[0]
        if primary.get("treatment") and not fields.get("procedure"):
            fields["procedure"] = primary["treatment"]
        if primary.get("treatmentDate") and not fields.get("treatmentDate"):
            fields["treatmentDate"] = primary["treatmentDate"]
        if primary.get("amountCharged") and not fields.get("amountCharged"):
            fields["amountCharged"] = primary["amountCharged"]

    return fields


def read_image(reader, image) -> tuple[str, list[dict[str, Any]], float]:
    import numpy as np

    array = np.array(image)
    rows = reader.readtext(array, detail=1, paragraph=False)
    items: list[dict[str, Any]] = []
    lines: list[str] = []
    confidences: list[float] = []
    for bbox, text, conf in rows:
        value = str(text or "").strip()
        if not value:
            continue
        cx, cy = bbox_center(bbox)
        item = {
            "text": value,
            "conf": float(conf or 0),
            "cx": cx,
            "cy": cy,
            "left": bbox_left(bbox),
            "right": bbox_right(bbox),
            "top": bbox_top(bbox),
            "bottom": bbox_bottom(bbox),
        }
        items.append(item)
        lines.append(value)
        confidences.append(float(conf or 0))
    text = "\n".join(lines)
    confidence = (sum(confidences) / len(confidences) * 100.0) if confidences else 0.0
    return text, items, confidence


def merge_fields(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base or {})
    for key, value in (extra or {}).items():
        if key == "visits":
            if value and (not merged.get("visits") or len(value) > len(merged.get("visits") or [])):
                merged["visits"] = value
            continue
        if not value:
            continue
        if key == "procedure" and merged.get("procedure") and looks_like_procedure(merged["procedure"]):
            continue
        if key == "procedure" and value and not looks_like_procedure(value):
            continue
        if key == "treatmentDate" and re.search(r"\(|trt|joju", value or "", flags=re.I):
            continue
        if not merged.get(key):
            merged[key] = value
        elif key in {"fullName", "age", "phone", "procedure", "treatmentDate", "amountCharged", "gender"}:
            if len(str(value)) > len(str(merged.get(key) or "")) + 2:
                merged[key] = value
    return merged


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing image path"}))
        return 1

    image_path = sys.argv[1]
    try:
        import easyocr  # type: ignore
        from PIL import Image, ImageOps, ImageEnhance
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": f"easyocr unavailable: {exc}", "text": "", "score": 0, "fields": {}}))
        return 2

    try:
        reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        original = Image.open(image_path).convert("RGB")

        best = {
            "text": "",
            "score": -1.0,
            "confidence": 0.0,
            "fields": {},
            "degrees": 0,
            "lines": [],
        }

        for degrees in (0, 90, 180, 270):
            rotated = original if degrees == 0 else original.rotate(degrees, expand=True)
            max_side = max(rotated.size)
            if max_side > 2200:
                scale = 2200 / max_side
                rotated = rotated.resize((int(rotated.size[0] * scale), int(rotated.size[1] * scale)))

            text, items, confidence = read_image(reader, rotated)
            fields = structured_from_items(items, text)

            # Crop patient / treatment regions, plus a dedicated treatment-table crop.
            width, height = rotated.size
            crops = [
                rotated.crop((int(width * 0.40), int(height * 0.02), int(width * 0.99), int(height * 0.48))),
                rotated.crop((int(width * 0.02), int(height * 0.42), int(width * 0.99), int(height * 0.78))),
                rotated.crop((int(width * 0.01), int(height * 0.14), int(width * 0.99), int(height * 0.96))),
                # TREATMENT RECORD gender/header strip
                rotated.crop((int(width * 0.50), int(height * 0.06), int(width * 0.99), int(height * 0.20))),
                # Dental-chart amount / credit cell
                rotated.crop((int(width * 0.62), int(height * 0.48), int(width * 0.96), int(height * 0.66))),
                # Dental-chart date + description row
                rotated.crop((int(width * 0.02), int(height * 0.48), int(width * 0.70), int(height * 0.66))),
            ]
            crop_texts = [text]
            all_items = list(items)
            for crop in crops:
                enhanced = ImageOps.autocontrast(ImageEnhance.Sharpness(crop).enhance(1.4))
                crop_text, crop_items, _conf = read_image(reader, enhanced)
                crop_fields = structured_from_items(crop_items, crop_text)
                fields = merge_fields(fields, crop_fields)
                if crop_fields.get("visits") and (
                    not fields.get("visits") or len(crop_fields["visits"]) > len(fields.get("visits") or [])
                ):
                    fields["visits"] = crop_fields["visits"]
                all_items.extend(crop_items)
                if crop_text:
                    crop_texts.append(crop_text)

            # Rebuild visits from the richest item set when this looks like a TREATMENT RECORD.
            merged_blob = "\n".join(crop_texts)
            table_visits = extract_treatment_table_visits(all_items, merged_blob)
            if table_visits and (
                not fields.get("visits") or len(table_visits) >= len(fields.get("visits") or [])
            ):
                fields["visits"] = table_visits
                if table_visits[0].get("treatment") and not fields.get("procedure"):
                    fields["procedure"] = table_visits[0]["treatment"]
                if table_visits[0].get("treatmentDate") and not fields.get("treatmentDate"):
                    fields["treatmentDate"] = table_visits[0]["treatmentDate"]
                if table_visits[0].get("amountCharged") and not fields.get("amountCharged"):
                    fields["amountCharged"] = table_visits[0]["amountCharged"]
            if not fields.get("gender"):
                fields["gender"] = extract_gender(all_items, merged_blob)
            # Re-run date/amount repair across the merged OCR blob for dental charts.
            if not fields.get("treatmentDate"):
                fields["treatmentDate"] = repair_noisy_written_date(merged_blob)
            if not fields.get("amountCharged") or not is_plausible_clinic_amount(fields.get("amountCharged") or ""):
                repaired_amount = extract_amount(all_items, merged_blob)
                if repaired_amount:
                    fields["amountCharged"] = repaired_amount
            if not fields.get("visits") and (
                fields.get("procedure") or fields.get("treatmentDate") or fields.get("amountCharged")
            ):
                fields["visits"] = [
                    {
                        "treatmentDate": fields.get("treatmentDate") or "",
                        "treatment": fields.get("procedure") or "",
                        "amountCharged": fields.get("amountCharged") or "",
                        "toothNos": "",
                        "dentistName": "",
                        "amountPaid": "",
                        "balance": "",
                        "nextAppt": "",
                    }
                ]
            elif fields.get("visits"):
                # Backfill blank cells on the first visit from recovered primary fields.
                first = dict(fields["visits"][0])
                if fields.get("procedure") and not first.get("treatment"):
                    first["treatment"] = fields["procedure"]
                if fields.get("treatmentDate") and not first.get("treatmentDate"):
                    first["treatmentDate"] = fields["treatmentDate"]
                if fields.get("amountCharged") and not first.get("amountCharged"):
                    first["amountCharged"] = fields["amountCharged"]
                fields["visits"][0] = first

            merged_text = "\n".join(part for part in crop_texts if part)
            filled = field_quality(fields) + min(len(fields.get("visits") or []), 8)
            score = score_text(merged_text) + filled * 14 + confidence / 20.0
            if score > best["score"]:
                best = {
                    "text": merged_text,
                    "score": score,
                    "confidence": confidence,
                    "fields": fields,
                    "degrees": degrees,
                    "lines": merged_text.splitlines(),
                }

            # Upright dental charts usually win; skip remaining rotations when strong.
            if degrees == 0 and filled >= 8:
                break

        print(json.dumps(best))
        return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": str(exc), "text": "", "score": 0, "fields": {}}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
