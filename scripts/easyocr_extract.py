#!/usr/bin/env python3
"""Optional handwriting-friendly OCR helper for Admin document sync."""

from __future__ import annotations

import json
import sys


KEYWORDS = [
    "name",
    "address",
    "telephone",
    "age",
    "occupation",
    "status",
    "complaint",
    "description",
    "amount",
    "date",
    "debit",
    "credit",
    "prophylaxis",
    "oral",
]


def score_text(text: str) -> float:
    lowered = (text or "").lower()
    score = min(len(lowered) / 40.0, 25.0)
    for keyword in KEYWORDS:
        if keyword in lowered:
            score += 8.0
    return score


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing image path"}))
        return 1

    image_path = sys.argv[1]
    try:
        import easyocr  # type: ignore
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": f"easyocr unavailable: {exc}", "text": "", "score": 0}))
        return 2

    try:
        reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        rows = reader.readtext(image_path, detail=1, paragraph=False)
        lines = []
        confidences = []
        for _bbox, text, conf in rows:
            value = str(text or "").strip()
            if not value:
                continue
            lines.append(value)
            confidences.append(float(conf or 0))
        text = "\n".join(lines)
        payload = {
            "text": text,
            "score": score_text(text),
            "confidence": (sum(confidences) / len(confidences) * 100.0) if confidences else 0.0,
            "lines": lines,
        }
        print(json.dumps(payload))
        return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": str(exc), "text": "", "score": 0}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
