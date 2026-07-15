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
DAILY_JSON = os.path.join(HERE, "output", "daily-prices.json")
OUT = os.path.join(HERE, "Almaza Master.xlsx")

MONTHS = [("06", "price_june"), ("07", "price_july"), ("08", "price_august"),
          ("09", "price_september"), ("10", "price_october")]

ICAL_BASE = "https://mohamedmaged3002-droid.github.io/almaza-ical/"
# Browsable per-unit photo gallery on Pages (R2 has no folder listing). The
# gallery img src points at the current photo URLs; swap to R2 once uploaded.
GALLERY_BASE = "https://mohamedmaged3002-droid.github.io/almaza-ical/photos/"

COLUMNS = [
    "source_code", "operator_unit_code", "wp_post_id",
    "lodgify_property_id", "lodgify_room_id", "title", "sub_community",
    "property_type", "guests_bluekeys", "guests_operator", "bedrooms", "beds",
    "bathrooms", "description", "amenities", "photo_gallery", "photo_count",
    "currency", "default_rate",
    "price_june", "price_july", "price_august", "price_september", "price_october",
    "pricing_note", "min_stay", "checkin_time",
    "checkout_time", "ical_url", "lat", "lng", "source_url", "status",
]

# Wider columns for free-text / URL fields; everything else gets a sane default.
COL_WIDTHS = {
    "title": 44, "sub_community": 22, "property_type": 16, "description": 60,
    "amenities": 50, "photo_gallery": 58, "pricing_note": 40, "ical_url": 58,
    "source_url": 58, "checkin_time": 14, "checkout_time": 18,
    "price_june": 13, "price_july": 13, "price_august": 13,
    "price_september": 14, "price_october": 13, "default_rate": 12,
}
DEFAULT_WIDTH = 14


def load_daily():
    """wp(str) -> [{date, price}] for the season, or {} if not generated yet."""
    if not os.path.exists(DAILY_JSON):
        return {}
    with open(DAILY_JSON, encoding="utf-8") as f:
        return json.load(f)


def segments_for(daily_rows):
    """Collapse per-date rows into contiguous same-price runs.
    Returns [{start, end, nights, price}] — the exact 'which nights = which
    price' the OTA team enters as date-range rates."""
    segs = []
    for r in sorted(daily_rows, key=lambda x: x["date"]):
        if segs and segs[-1]["price"] == r["price"] and _next_day(segs[-1]["end"]) == r["date"]:
            segs[-1]["end"] = r["date"]
            segs[-1]["nights"] += 1
        else:
            segs.append({"start": r["date"], "end": r["date"], "nights": 1, "price": r["price"]})
    return segs


def _next_day(iso_date):
    from datetime import date, timedelta
    y, m, d = map(int, iso_date.split("-"))
    return (date(y, m, d) + timedelta(days=1)).isoformat()


def month_price(daily_rows, mm):
    """Accurate price for calendar month `mm` from the per-date rows.
    Returns a single int if every night in the month shares one price, else the
    string 'MIN–MAX ⚠' to signal the OTA team must set NIGHTLY (date-specific)
    rates for that month. Blank if the month has no priced nights."""
    prices = sorted({r["price"] for r in daily_rows if r["date"][5:7] == mm})
    if not prices:
        return ""
    if len(prices) == 1:
        return prices[0]
    return f"{prices[0]:,}–{prices[-1]:,} ⚠"


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


def row_for(u, min_stays, daily):
    rates = u.get("rates") or {}
    photos = u.get("photos") or []
    lat = u.get("lat")
    lng = u.get("lng")
    daily_rows = daily.get(str(u.get("wp"))) or daily.get(u.get("wp")) or []
    month_vals = [month_price(daily_rows, mm) for mm, _ in MONTHS]
    varies = [name.split("_")[1] for (mm, name), v in zip(MONTHS, month_vals)
              if isinstance(v, str) and v]
    note = ("see 'Nightly Rates' tab — varies in " + ", ".join(varies)) if varies else "flat monthly rates"
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
        rates.get("currency"),
        rates.get("defaultRate"),
        *month_vals,                    # price_june .. price_october
        note,
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
    daily = load_daily()

    wb = Workbook()
    ws = wb.active
    ws.title = "Almaza Master"

    ws.append(COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    n_min_stay = 0
    n_needs_pin = 0
    for u in units:
        row = row_for(u, min_stays, daily)
        ws.append(row)
        if row[COLUMNS.index("min_stay")] != "":
            n_min_stay += 1
        if row[COLUMNS.index("lat")] == "NEEDS PIN" or row[COLUMNS.index("lng")] == "NEEDS PIN":
            n_needs_pin += 1

    for i, col in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = COL_WIDTHS.get(col, DEFAULT_WIDTH)

    ws.freeze_panes = "A2"  # freeze the header row

    # --- Second tab: exact night-by-night rates (date-range segments) ----------
    ws2 = wb.create_sheet("Nightly Rates")
    NR_COLS = ["wp_post_id", "source_code", "operator_unit_code", "sub_community",
               "start_date", "end_date", "nights", "price_egp"]
    ws2.append(NR_COLS)
    for cell in ws2[1]:
        cell.font = Font(bold=True)
    n_seg = 0
    for u in units:
        rows = daily.get(str(u.get("wp"))) or daily.get(u.get("wp")) or []
        for s in segments_for(rows):
            ws2.append([
                u.get("wp"), u.get("sourceCode"), u.get("operatorCode"),
                u.get("subCommunity") or "",
                s["start"], s["end"], s["nights"], s["price"],
            ])
            n_seg += 1
    for i, w in enumerate([12, 11, 18, 16, 13, 13, 8, 12], start=1):
        ws2.column_dimensions[get_column_letter(i)].width = w
    ws2.freeze_panes = "A2"
    ws2.auto_filter.ref = f"A1:H{ws2.max_row}"  # filterable by unit

    wb.save(OUT)
    print(f"Wrote {OUT}")
    print(f"Sheet 1 'Almaza Master' rows (units): {len(units)}")
    print(f"Sheet 2 'Nightly Rates' segment rows: {n_seg}")
    print(f"Rows with min_stay: {n_min_stay}  |  blank: {len(units) - n_min_stay}")
    print(f"Rows with lat/lng = 'NEEDS PIN': {n_needs_pin}")


if __name__ == "__main__":
    main()
