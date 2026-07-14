#!/usr/bin/env python3
"""build-sheet.py — OTA listing-build pack for the Almaza Bay project.

Reads the completed content scrape at output/units/*.json (152 files) and emits
Almaza Master.xlsx — one row per unit for the OTA team. NO network, NO DB.

min_stay is read from docs/index.json (properties[].minStay, keyed by wp) if the
file exists; the availability sync may still be running when this builds, so a
missing index.json (or a wp absent from it) simply leaves min_stay blank.
"""
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
UNITS_DIR = os.path.join(HERE, "output", "units")
INDEX_JSON = os.path.join(HERE, "docs", "index.json")
OUT = os.path.join(HERE, "Almaza Master.xlsx")

ICAL_BASE = "https://mohamedmaged3002-droid.github.io/almaza-ical/"
# Browsable per-unit photo gallery on Pages (R2 has no folder listing). The
# gallery img src points at the current photo URLs; swap to R2 once uploaded.
GALLERY_BASE = "https://mohamedmaged3002-droid.github.io/almaza-ical/photos/"

COLUMNS = [
    "source_code", "operator_unit_code", "wp_post_id",
    "lodgify_property_id", "lodgify_room_id", "title", "sub_community",
    "property_type", "guests_bluekeys", "guests_operator", "bedrooms", "beds",
    "bathrooms", "description", "amenities", "photo_gallery", "photo_count",
    "rate_default", "rate_periods", "currency", "min_stay", "checkin_time",
    "checkout_time", "ical_url", "lat", "lng", "source_url", "status",
]

# Wider columns for free-text / URL fields; everything else gets a sane default.
COL_WIDTHS = {
    "title": 44, "sub_community": 22, "property_type": 16, "description": 60,
    "amenities": 50, "photo_folder": 50, "rate_periods": 34, "ical_url": 58,
    "source_url": 58, "checkin_time": 14, "checkout_time": 18,
}
DEFAULT_WIDTH = 14


def load_units():
    units = []
    for name in os.listdir(UNITS_DIR):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(UNITS_DIR, name), encoding="utf-8") as f:
            units.append(json.load(f))
    units.sort(key=lambda u: u.get("wp", 0))
    return units


def load_min_stays():
    """wp -> minStay from docs/index.json, or {} if absent/unreadable."""
    if not os.path.exists(INDEX_JSON):
        return {}
    try:
        with open(INDEX_JSON, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    out = {}
    for p in data.get("properties", []):
        wp = p.get("wp")
        ms = p.get("minStay")
        if wp is not None and ms is not None:
            out[wp] = ms
    return out


def row_for(u, min_stays):
    rates = u.get("rates") or {}
    periods = rates.get("periods") or []
    rate_periods = "; ".join(f"{p.get('name')}: {p.get('price')}" for p in periods)
    photos = u.get("photos") or []
    lat = u.get("lat")
    lng = u.get("lng")
    return [
        u.get("sourceCode"),
        u.get("operatorCode"),
        u.get("wp"),
        u.get("propertyId"),
        rates.get("roomId"),
        u.get("title"),
        u.get("subCommunity") or "UNKNOWN — needs review",
        "Vacation Rental",
        u.get("guestsBluekeys"),
        u.get("guestsOperator"),
        u.get("bedrooms"),
        u.get("bedrooms"),  # beds — Lodgify gives no separate bed count
        u.get("bathrooms"),
        u.get("description"),
        ", ".join(u.get("amenities") or []),
        GALLERY_BASE + str(u.get("wp")) + ".html",
        len(photos),
        rates.get("defaultRate"),
        rate_periods,
        rates.get("currency"),
        min_stays.get(u.get("wp"), ""),
        u.get("checkinTime"),
        u.get("checkoutTime"),
        ICAL_BASE + str(u.get("wp")) + ".ics",
        "NEEDS PIN" if lat is None else lat,
        "NEEDS PIN" if lng is None else lng,
        u.get("sourceUrl"),
        "draft",
    ]


def main():
    units = load_units()
    min_stays = load_min_stays()

    wb = Workbook()
    ws = wb.active
    ws.title = "Almaza Master"

    ws.append(COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    n_min_stay = 0
    n_needs_pin = 0
    for u in units:
        row = row_for(u, min_stays)
        ws.append(row)
        if row[COLUMNS.index("min_stay")] != "":
            n_min_stay += 1
        if row[COLUMNS.index("lat")] == "NEEDS PIN" or row[COLUMNS.index("lng")] == "NEEDS PIN":
            n_needs_pin += 1

    for i, col in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = COL_WIDTHS.get(col, DEFAULT_WIDTH)

    ws.freeze_panes = "A2"  # freeze the header row

    wb.save(OUT)
    print(f"Wrote {OUT}")
    print(f"Sheet rows (units): {len(units)}")
    print(f"Rows with min_stay: {n_min_stay}  |  blank: {len(units) - n_min_stay}")
    print(f"Rows with lat/lng = 'NEEDS PIN': {n_needs_pin}")


if __name__ == "__main__":
    main()
