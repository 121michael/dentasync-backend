#!/usr/bin/env python3
"""Layout-aware OCR for Admin dental document sync.

Tries multiple rotations, associates handwritten values with printed labels
using bounding boxes, and returns structured fields for direct form fill.
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
            # avoid matching "date" to "date of birth" when alias is exact date only handled by caller
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

    # Prefer the topmost matching label (patient block / first table row).
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
            # Keep nearby consecutive lines under the label.
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


def extract_amount(items: list[dict[str, Any]], text: str) -> str:
    direct = find_values_for_label(items, LABELS["amountCharged"])
    digits = re.findall(r"\b([1-9]\d{2,5})(?:\.00)?\b", direct or "")
    if digits:
        return digits[0]
    # Fallback: number near the word AMOUNT in full text.
    match = re.search(r"\bamount\b[\s\S]{0,80}?\b([1-9]\d{2,5})\b", text, flags=re.I)
    return match.group(1) if match else ""


def extract_phone(value: str, text: str) -> str:
    candidates = []
    for source in [value or "", text or ""]:
        repaired = (
            source.lower()
            .replace("o", "0")
            .replace("i", "1")
            .replace("l", "1")
            .replace("s", "5")
            .replace("b", "8")
        )
        candidates.extend(re.findall(r"0?9\d{9}", re.sub(r"\D", "", repaired)))
        candidates.extend(re.findall(r"0?9[\d\s\-.]{9,16}", source))
    for candidate in candidates:
        digits = re.sub(r"\D", "", candidate)
        if re.fullmatch(r"0\d{10}", digits) or re.fullmatch(r"9\d{9}", digits):
            return digits if digits.startswith("0") else f"0{digits}"
    return clean_value(value)


def extract_age(value: str) -> str:
    match = re.search(r"\b(\d{1,3})\b", value or "")
    if not match:
        return ""
    age = int(match.group(1))
    # Single-digit ages from handwriting OCR are usually truncated (e.g. 25 -> 2).
    if age < 10:
        return ""
    return str(age) if age <= 120 else ""


def normalize_date(value: str) -> str:
    text = clean_value(value)
    if not text:
        return ""
    month = re.search(
        r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-.]?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(\d{4})\b",
        text,
        flags=re.I,
    )
    if month:
        months = {
            "jan": "01",
            "feb": "02",
            "mar": "03",
            "apr": "04",
            "may": "05",
            "jun": "06",
            "jul": "07",
            "aug": "08",
            "sep": "09",
            "oct": "10",
            "nov": "11",
            "dec": "12",
        }
        token = month.group(1).lower()[:3]
        return f"{month.group(3)}-{months[token]}-{int(month.group(2)):02d}"
    slash = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", text)
    if slash:
        y = slash.group(3)
        if len(y) == 2:
            y = f"20{y}"
        return f"{y}-{int(slash.group(1)):02d}-{int(slash.group(2)):02d}"
    return ""


def infer_procedure(text: str, value: str) -> str:
    blob = f"{value}\n{text}".lower()
    mapping = [
        (r"oral\s*prophylaxis|prophylax|pr[o0]r?h?[il1y]{2,}|prophy", "Oral Prophylaxis"),
        (r"cleaning", "Dental Cleaning"),
        (r"\bexo\b|extraction", "Tooth Extraction"),
        (r"root\s*canal|\brct\b", "Root Canal"),
        (r"filling|resto", "Dental Filling"),
        (r"whitening|bleach", "Teeth Whitening"),
        (r"crown", "Dental Crown"),
        (r"implant", "Dental Implant"),
        (r"ortho(?:dontic)?\s*install|installation", "Orthodontic Installation"),
        (r"ortho(?:dontic)?\s*adjust|adjustment|orthodont|brace", "Orthodontic Adjustment"),
    ]
    for pattern, label in mapping:
        if re.search(pattern, blob, flags=re.I):
            return label
    return clean_value(value)


def extract_treatment_record_fields(text: str) -> dict[str, str]:
    """Best-effort autofill from multi-row TREATMENT RECORD OCR text."""
    blob = text or ""
    # Require tooth-column style grids, not simple patient treatment forms.
    if not re.search(r"tooth\s*no|\btooth\b", blob, flags=re.I):
        return {}
    if not re.search(r"treatment\s*record|\bprocedure\b", blob, flags=re.I):
        return {}

    procedure = ""
    if re.search(r"ortho(?:dontic)?\s*install|installation", blob, flags=re.I):
        procedure = "Orthodontic Installation"
    elif re.search(r"\bexo\b|extraction", blob, flags=re.I):
        procedure = "Tooth Extraction"
    elif re.search(r"ortho(?:dontic)?\s*adjust|adjustment|orthodont", blob, flags=re.I):
        procedure = "Orthodontic Adjustment"

    amounts = re.findall(r"\b([1-9]\d{2,5})(?:\.00)?\b", blob)
    amount = ""
    for candidate in amounts:
        if re.fullmatch(r"20\d{2}", candidate):
            continue
        value = int(candidate)
        if 100 <= value <= 200000:
            amount = candidate
            if procedure == "Orthodontic Installation" or value >= 3000:
                break

    month = re.search(
        r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-.]?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(20\d{2})\b",
        blob,
        flags=re.I,
    )
    treatment_date = normalize_date(month.group(0)) if month else ""

    notes = "Treatment record form detected."
    return {
        "procedure": procedure,
        "treatmentDate": treatment_date,
        "amountCharged": amount,
        "notes": notes,
    }


def structured_from_items(items: list[dict[str, Any]], text: str) -> dict[str, str]:
    full_name = find_values_for_label(items, LABELS["fullName"], multi=True)
    address = find_values_for_label(items, LABELS["address"], multi=True)
    phone = extract_phone(find_values_for_label(items, LABELS["phone"]), text)
    age = extract_age(find_values_for_label(items, LABELS["age"]))
    procedure = infer_procedure(text, find_values_for_label(items, LABELS["procedure"], multi=True))
    treatment_date = normalize_date(find_values_for_label(items, LABELS["treatmentDate"], multi=True))
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

    # Fill gaps from TREATMENT RECORD table heuristics.
    record_fields = extract_treatment_record_fields(text)
    for key, value in record_fields.items():
        if value and not fields.get(key):
            fields[key] = value

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


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing image path"}))
        return 1

    image_path = sys.argv[1]
    try:
        import easyocr  # type: ignore
        from PIL import Image
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
            # Keep OCR responsive on phone photos.
            max_side = max(rotated.size)
            if max_side > 2200:
                scale = 2200 / max_side
                rotated = rotated.resize((int(rotated.size[0] * scale), int(rotated.size[1] * scale)))
            text, items, confidence = read_image(reader, rotated)
            fields = structured_from_items(items, text)
            filled = sum(1 for value in fields.values() if value)
            score = score_text(text) + filled * 12 + confidence / 20.0
            if score > best["score"]:
                best = {
                    "text": text,
                    "score": score,
                    "confidence": confidence,
                    "fields": fields,
                    "degrees": degrees,
                    "lines": text.splitlines(),
                }

        print(json.dumps(best))
        return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": str(exc), "text": "", "score": 0, "fields": {}}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
