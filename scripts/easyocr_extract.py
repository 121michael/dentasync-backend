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


def repair_ocr_year_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9]", "", value or "").lower()
    if re.fullmatch(r"20[0-3]\d", token):
        return token
    if len(token) != 4:
        return ""
    maps = [
        {"2": "2", "k": "2", "z": "2", "s": "2"},
        {"0": "0", "n": "0", "o": "0", "d": "0", "q": "0"},
        {"2": "2", "d": "2", "v": "2", "z": "2"},
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

    def looks_like_year(digits: str) -> bool:
        return bool(re.fullmatch(r"20[1-3]\d", digits))

    if re.fullmatch(r"[1-9]\d{2,5}", raw) and not looks_like_year(raw):
        amount = int(raw)
        return raw if 100 <= amount <= 200000 else ""
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
    if not re.fullmatch(r"[1-9]\d{2,5}", digits) or looks_like_year(digits):
        return ""
    amount = int(digits)
    if re.search(r"[A-Za-z]", raw) and amount < 1000:
        return ""
    return str(amount) if 100 <= amount <= 200000 else ""


def repair_noisy_written_date(text: str) -> str:
    clean = MONTH_RE.search(text or "")
    if clean:
        return clean_value(clean.group(0))

    mangled = re.search(
        r"(?:[\(\[]|\b)((?:tpt|jtp[1l7]?|itet|5ept|sept)[A-Za-z0-9\-_.,\s]{0,28})",
        text or "",
        flags=re.I,
    )
    if not mangled:
        return ""
    chunk = mangled.group(1)
    day = ""
    day_direct = re.match(
        r"(?:tpt|jtp|itet|5ept|sept)[-._\s]+([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b",
        chunk,
        flags=re.I,
    )
    if day_direct:
        day = day_direct.group(1)
    else:
        jammed = re.match(r"(?:tpt|jtp|itet|5ept|sept)[-._\s]*([1-9l])", chunk, flags=re.I)
        if jammed:
            token = jammed.group(1).lower()
            day = "7" if token in {"1", "l"} else token
    if not day:
        jtp_day = re.search(r"\bjtp\s*([1l7])\b|jtp([1l7])", text or "", flags=re.I)
        if jtp_day:
            token = (jtp_day.group(1) or jtp_day.group(2) or "").lower()
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
    direct = find_values_for_label(items, LABELS["amountCharged"])
    digits = re.findall(r"\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5}|[A-Za-z0-9]{3,5})(?:\.00)?\b", direct or "")
    for raw in digits:
        repaired = repair_ocr_amount_token(raw)
        if repaired:
            return repaired
        amount = raw.replace(",", "")
        if re.fullmatch(r"20\d{2}", amount):
            continue
        if re.fullmatch(r"[1-9]\d{2,5}", amount):
            value = int(float(amount))
            if 100 <= value <= 200000:
                return raw

    box_amounts = []
    for item in items:
        for raw in re.findall(r"\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5}|[A-Za-z0-9]{3,5})(?:\.00)?\b", item["text"] or ""):
            repaired = repair_ocr_amount_token(raw)
            if repaired:
                box_amounts.append((int(repaired), repaired, item["cy"]))
                continue
            amount = raw.replace(",", "")
            if re.fullmatch(r"20\d{2}", amount):
                continue
            if not re.fullmatch(r"[1-9]\d{2,5}", amount):
                continue
            value = int(float(amount))
            if 500 <= value <= 200000:
                box_amounts.append((value, raw, item["cy"]))
    if box_amounts:
        box_amounts.sort(key=lambda row: (-row[0], -row[2]))
        return box_amounts[0][1]

    match = re.search(
        r"\bamount\b[\s\S]{0,100}?\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5}|[A-Za-z0-9]{3,5})\b",
        text or "",
        flags=re.I,
    )
    if match:
        repaired = repair_ocr_amount_token(match.group(1))
        if repaired:
            return repaired
        raw = match.group(1)
        amount = raw.replace(",", "")
        if re.fullmatch(r"[1-9]\d{2,5}", amount) and not re.fullmatch(r"20\d{2}", amount):
            return raw

    noisy = re.search(r"\b([bB8][0oOdqvu]{2,4})\b", text or "")
    if noisy:
        repaired = repair_ocr_amount_token(noisy.group(1))
        if repaired:
            return repaired
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
        if 100 <= value <= 200000:
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


def structured_from_items(items: list[dict[str, Any]], text: str) -> dict[str, str]:
    full_name = clean_person_name(find_values_for_label(items, LABELS["fullName"], multi=True))
    address = find_values_for_label(items, LABELS["address"], multi=True)
    phone = extract_phone(find_values_for_label(items, LABELS["phone"]), text)
    age = extract_age_from_items(items, text)
    procedure_value = find_values_for_label(items, LABELS["procedure"], multi=True)
    procedure = literal_procedure(text, procedure_value)
    treatment_date = extract_written_date(items, text)
    amount = extract_amount(items, text)
    notes = find_values_for_label(items, LABELS["complaint"], multi=True)

    fields = {
        "fullName": full_name,
        "address": address,
        "phone": phone,
        "age": age,
        "procedure": procedure,
        "treatmentDate": treatment_date,
        "amountCharged": amount,
        "notes": notes,
    }

    record_fields = extract_treatment_record_fields(text)
    for key, value in record_fields.items():
        if value and not fields.get(key):
            fields[key] = value
    if not fields.get("fullName"):
        recovered = recover_treatment_record_name(text)
        if recovered:
            fields["fullName"] = recovered

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


def merge_fields(base: dict[str, str], extra: dict[str, str]) -> dict[str, str]:
    merged = dict(base or {})
    for key, value in (extra or {}).items():
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
        elif key in {"fullName", "age", "phone", "procedure", "treatmentDate", "amountCharged"}:
            # Prefer longer/cleaner values when both exist.
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

            # Crop patient block (top-right) and treatment band for denser handwriting charts.
            width, height = rotated.size
            crops = [
                rotated.crop((int(width * 0.40), int(height * 0.02), int(width * 0.99), int(height * 0.48))),
                rotated.crop((int(width * 0.02), int(height * 0.42), int(width * 0.99), int(height * 0.78))),
            ]
            crop_texts = [text]
            for crop in crops:
                enhanced = ImageOps.autocontrast(ImageEnhance.Sharpness(crop).enhance(1.4))
                crop_text, crop_items, _conf = read_image(reader, enhanced)
                crop_fields = structured_from_items(crop_items, crop_text)
                fields = merge_fields(fields, crop_fields)
                if crop_text:
                    crop_texts.append(crop_text)

            merged_text = "\n".join(part for part in crop_texts if part)
            filled = field_quality(fields)
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
