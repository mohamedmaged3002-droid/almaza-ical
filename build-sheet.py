#!/usr/bin/env python3
"""build-sheet.py — OTA listing-build pack for Almaza Bay, in the Brassbell format.

Three tabs (mirrors "Brassbell Onboarding OTAs"):
  1. Almaza Master  — one row per unit (identity, photos, iCal, guests, coords).
  2. Monthly Prices — one row per unit; a column per month with the real nightly
     USD. If a month's price changes mid-month the cell shows the exact day
     ranges (e.g. "1–22: $380 / 23–31: $440"). Per-row green→red heatmap.
  3. Price Ranges   — one row per continuous date range at one flat nightly USD.

Prices are the operator's real EGP rates (period price, else Default Rate)
converted to USD at the pinned FX below — the same convention as the Brassbell
OTA sheet. NO network, NO DB.
"""
import json
import os
from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

HERE = os.path.dirname(os.path.abspath(__file__))
UNITS_DIR = os.path.join(HERE, "output", "units")
INDEX_JSON = os.path.join(HERE, "docs", "index.json")
DAILY_JSON = os.path.join(HERE, "output", "daily-prices.json")
OUT = os.path.join(HERE, "Almaza Master.xlsx")

# Pinned EGP->USD for OTA listings (same convention as the Brassbell sheet).
FX = 50
ICAL_BASE = "https://mohamedmaged3002-droid.github.io/almaza-ical/"
GALLERY_BASE = "https://mohamedmaged3002-droid.github.io/almaza-ical/photos/"

# Almaza's operator rates only cover the summer season Jun–Oct 2026.
MONTHS = [("06", "Jun '26"), ("07", "Jul '26"), ("08", "Aug '26"),
          ("09", "Sep '26"), ("10", "Oct '26")]

HDR_FILL = PatternFill("solid", fgColor="1F4E79")
HDR_FONT = Font(bold=True, color="FFFFFF")
BLANK_FILL = PatternFill("solid", fgColor="EDEDED")


# ----- data loading ----------------------------------------------------------
def load_units():
    units = []
    for name in os.listdir(UNITS_DIR):
        if name.endswith(".json"):
            with open(os.path.join(UNITS_DIR, name), encoding="utf-8") as f:
                units.append(json.load(f))
    units.sort(key=lambda u: u.get("wp", 0))
    return units


def load_min_stays():
    if not os.path.exists(INDEX_JSON):
        return {}
    try:
        with open(INDEX_JSON, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    return {p["wp"]: p.get("minStay") for p in data.get("properties", []) if p.get("wp") is not None}


def load_daily():
    if not os.path.exists(DAILY_JSON):
        return {}
    with open(DAILY_JSON, encoding="utf-8") as f:
        return json.load(f)


def daily_of(daily, u):
    return daily.get(str(u.get("wp"))) or daily.get(u.get("wp")) or []


# ----- pricing helpers -------------------------------------------------------
def usd(egp):
    return round(egp / FX)


def month_segments(daily_rows, mm):
    """Day-of-month runs of one price in month mm: [{d1, d2, usd}]."""
    days = sorted((r for r in daily_rows if r["date"][5:7] == mm), key=lambda x: x["date"])
    segs = []
    for r in days:
        d, p = int(r["date"][8:10]), usd(r["price"])
        if segs and segs[-1]["usd"] == p and segs[-1]["d2"] == d - 1:
            segs[-1]["d2"] = d
        else:
            segs.append({"d1": d, "d2": d, "usd": p})
    return segs


def month_cell(daily_rows, mm):
    """(display_text, representative_usd_for_colour). Blank if no priced days."""
    segs = month_segments(daily_rows, mm)
    if not segs:
        return "", None
    if len(segs) == 1:
        return f"${segs[0]['usd']}", segs[0]["usd"]
    lines = [(f"{s['d1']}–{s['d2']}: ${s['usd']}" if s["d1"] != s["d2"] else f"{s['d1']}: ${s['usd']}")
             for s in segs]
    prices = sorted(usd(r["price"]) for r in daily_rows if r["date"][5:7] == mm)
    return "\n".join(lines), prices[len(prices) // 2]   # median for the heatmap


def heat_color(t):
    """green #63BE7B -> yellow #FFEB84 -> red #F8696B, t in [0,1]."""
    g, y, r = (0x63, 0xBE, 0x7B), (0xFF, 0xEB, 0x84), (0xF8, 0x69, 0x6B)
    a, b, tt = (g, y, t * 2) if t <= 0.5 else (y, r, (t - 0.5) * 2)
    c = tuple(round(a[i] + (b[i] - a[i]) * tt) for i in range(3))
    return f"{c[0]:02X}{c[1]:02X}{c[2]:02X}"


def next_day(iso_date):
    y, m, d = map(int, iso_date.split("-"))
    return (date(y, m, d) + timedelta(days=1)).isoformat()


def segments_for(daily_rows):
    """Full-season contiguous same-price runs: [{start, end, nights, usd}]."""
    segs = []
    for r in sorted(daily_rows, key=lambda x: x["date"]):
        p = usd(r["price"])
        if segs and segs[-1]["usd"] == p and next_day(segs[-1]["end"]) == r["date"]:
            segs[-1]["end"] = r["date"]
            segs[-1]["nights"] += 1
        else:
            segs.append({"start": r["date"], "end": r["date"], "nights": 1, "usd": p})
    return segs


# ----- sheet builders --------------------------------------------------------
def style_headers(ws, row):
    for cell in ws[row]:
        cell.font = HDR_FONT
        cell.fill = HDR_FILL
        cell.alignment = Alignment(vertical="center")


def build_master(ws, units, min_stays):
    ws.append(["Almaza Bay — OTA listing pack"])
    ws.append([f"One row per unit. Prices in the Monthly Prices / Price Ranges tabs (USD = EGP ÷ {FX})."])
    ws.append([])
    cols = ["wp_post_id", "source_code", "operator_unit_code", "sub_community", "title",
            "property_type", "guests_bluekeys", "guests_operator", "bedrooms", "bathrooms",
            "default_rate_usd", "min_stay", "checkin_time", "checkout_time",
            "amenities", "photo_gallery", "photo_count", "ical_url",
            "lat", "lng", "source_url", "status"]
    ws.append(cols)
    style_headers(ws, 4)
    for u in units:
        rates = u.get("rates") or {}
        lat, lng = u.get("lat"), u.get("lng")
        ws.append([
            u.get("wp"), u.get("sourceCode"), u.get("operatorCode"),
            u.get("subCommunity") or "UNKNOWN — needs review", u.get("title"),
            "Vacation Rental", u.get("guestsBluekeys"), u.get("guestsOperator"),
            u.get("bedrooms"), u.get("bathrooms"),
            usd(rates["defaultRate"]) if rates.get("defaultRate") is not None else "",
            min_stays.get(u.get("wp"), ""), u.get("checkinTime"), u.get("checkoutTime"),
            ", ".join(u.get("amenities") or []),
            GALLERY_BASE + str(u.get("wp")) + ".html", len(u.get("photos") or []),
            ICAL_BASE + str(u.get("wp")) + ".ics",
            "NEEDS PIN" if lat is None else lat, "NEEDS PIN" if lng is None else lng,
            u.get("sourceUrl"), "draft",
        ])
    widths = {"title": 42, "sub_community": 20, "amenities": 50, "photo_gallery": 56,
              "ical_url": 56, "source_url": 56, "checkin_time": 12, "checkout_time": 16}
    for i, c in enumerate(cols, 1):
        ws.column_dimensions[ws.cell(4, i).column_letter].width = widths.get(c, 13)
    ws.freeze_panes = "A5"


def build_monthly(ws, units, daily):
    ws.append(["Nightly price by month — USD (one row per listing)"])
    ws.append([f'One row per unit. Each month = real nightly USD (EGP ÷ {FX}). If a month splits '
               f'(e.g. "1–22: $380 / 23–31: $440") the price changed mid-month — both real, with the '
               f'exact days. Operator rates cover Jun–Oct 2026 only. Colour: green = low → red = peak (per row).'])
    ws.append([])
    cols = ["wp", "Code/Slug", "Title", "Area", "Beds"] + [lbl for _, lbl in MONTHS]
    ws.append(cols)
    style_headers(ws, 4)

    r = 5
    for u in units:
        rows = daily_of(daily, u)
        cells, reps = [], []
        for mm, _ in MONTHS:
            txt, rep = month_cell(rows, mm)
            cells.append(txt)
            reps.append(rep)
        ws.append([u.get("wp"), u.get("slug"), u.get("title"),
                   u.get("subCommunity") or "", u.get("bedrooms")] + cells)
        # per-row heatmap over the month reps
        valid = [x for x in reps if x is not None]
        lo, hi = (min(valid), max(valid)) if valid else (0, 0)
        max_lines = 1
        for j, rep in enumerate(reps):
            cell = ws.cell(r, 6 + j)
            cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
            if rep is None:
                continue
            t = (rep - lo) / (hi - lo) if hi > lo else 0.0
            cell.fill = PatternFill("solid", fgColor=heat_color(t))
            max_lines = max(max_lines, str(cell.value).count("\n") + 1)
        ws.row_dimensions[r].height = 15 * max_lines
        r += 1

    for i, w in enumerate([8, 26, 34, 18, 6] + [16] * len(MONTHS), 1):
        ws.column_dimensions[ws.cell(4, i).column_letter].width = w
    ws.freeze_panes = "F5"


def build_ranges(ws, units, daily):
    ws.append(["Nightly price by date range — USD (exact, no estimation)"])
    ws.append([f"Each row = a continuous date range at one flat nightly rate, from Almaza's Lodgify rates "
               f"(named period price, else the operator's Default Rate; no averaging). USD = EGP ÷ {FX}."])
    ws.append([])
    cols = ["wp", "Code/Slug", "Title", "Area", "Beds", "From", "To", "Nights", "Nightly USD"]
    ws.append(cols)
    style_headers(ws, 4)
    n = 0
    for u in units:
        for s in segments_for(daily_of(daily, u)):
            ws.append([u.get("wp"), u.get("slug"), u.get("title"), u.get("subCommunity") or "",
                       u.get("bedrooms"), s["start"], s["end"], s["nights"], f"${s['usd']}"])
            n += 1
    for i, w in enumerate([8, 26, 34, 18, 6, 13, 13, 8, 12], 1):
        ws.column_dimensions[ws.cell(4, i).column_letter].width = w
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:I{ws.max_row}"
    return n


def main():
    units = load_units()
    min_stays = load_min_stays()
    daily = load_daily()

    wb = Workbook()
    build_master(wb.active, units, min_stays)
    wb.active.title = "Almaza Master"
    build_monthly(wb.create_sheet("Monthly Prices"), units, daily)
    n_seg = build_ranges(wb.create_sheet("Price Ranges"), units, daily)

    wb.save(OUT)
    print(f"Wrote {OUT}")
    print(f"Tabs: {wb.sheetnames}")
    print(f"Units: {len(units)}  |  Price-range rows: {n_seg}  |  FX: EGP/{FX}=USD")


if __name__ == "__main__":
    main()
