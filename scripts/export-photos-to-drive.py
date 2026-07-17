#!/usr/bin/env python3
"""Export each Almaza unit's photos from R2 (photos.bluekeys.co) into a per-unit
Google Drive folder on maged@bluekeys.co (the rclone `bluekeys:` remote, 307 GB),
set the folder to 'anyone with the link', and record wp -> {folder, share link}
in data/drive-photo-links.json. The OTA master sheet's photo column reads that
map (build-sheet.py), so the OTA team browses a real Drive folder of photos per
unit instead of the R2/Pages links.

Recipe (adapted from reference_r2_photos_to_gdrive, Brassbell 153 units/1490 photos):
  - Photos are raw static WebP on the Cloudflare custom domain (photos.bluekeys.co),
    NOT the throttled r2.dev endpoint or the metered /cdn-cgi/image transform — so
    downloads parallelize safely (6 workers), retrying transient errors but never a
    clean 404. Count comes from the committed bundle's photoCount (verified to match
    the DB/R2 exactly). Units are still processed one at a time.
  - One temp dir per unit, deleted immediately (Mac ~2 GB free — never stage all) — L-022.
  - Drive uploads concurrent (rclone copy --transfers 12).
  - `rclone link` on a folder BOTH sets the public 'anyone with link' permission
    AND returns the share URL.
Resumable: units already in data/drive-photo-links.json are skipped.
Env: ONLY=91038,91018 (subset) · LIMIT=N (first N not-done) · DRY=1 (no upload).
"""
import json, os, re, shutil, subprocess, tempfile, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUNDLE = os.path.join(ROOT, "data", "sheet-content.json")
RESULTS = os.path.join(ROOT, "data", "drive-photo-links.json")
CDN = "https://photos.bluekeys.co"
REMOTE = "bluekeys:"                      # = maged@bluekeys.co (verified via owner metadata)
DEST_PARENT = "BlueKeys Photos/Almaza Unit Photos"
MAX_PHOTOS = 120                          # probe-loop safety cap
GAP_STOP = 3                              # stop after this many consecutive misses

ONLY = set(filter(None, (os.environ.get("ONLY") or "").split(",")))
LIMIT = int(os.environ.get("LIMIT") or 0)
DRY = os.environ.get("DRY") == "1"
# The Drive account uses rclone's shared (throttled) API project — no client_id —
# so a single upload call runs ~9s regardless of size. Process several units at
# once so that per-call latency overlaps; rclone's own 403-backoff handles the
# shared-quota pacing. Downloads stay 6-parallel per unit.
UNIT_WORKERS = int(os.environ.get("UNIT_WORKERS") or 4)


def sanitize(name: str) -> str:
    name = (name or "").replace("/", "-").replace("\\", "-")
    return re.sub(r"\s+", " ", name).strip()[:120]


def fetch(url: str, dest: str) -> str:
    """Returns 'ok' (saved), '404' (genuinely absent — don't retry), or 'error'
    (transient — retry)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "bluekeys-photo-export"})
        with urllib.request.urlopen(req, timeout=30) as r:
            if r.status != 200:
                return "error"
            data = r.read()
        if not data:
            return "error"
        with open(dest, "wb") as f:
            f.write(data)
        return "ok"
    except urllib.error.HTTPError as e:
        return "404" if e.code == 404 else "error"
    except Exception:  # noqa: BLE001
        return "error"


def rclone(*args):
    return subprocess.run(["rclone", *args], capture_output=True, text=True)


def save(results):
    tmp = RESULTS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1, ensure_ascii=False)
    os.replace(tmp, RESULTS)


def main():
    units = json.load(open(BUNDLE, encoding="utf-8"))
    results = json.load(open(RESULTS, encoding="utf-8")) if os.path.exists(RESULTS) else {}
    done = {k for k, v in results.items() if v.get("count", 0) > 0 or v.get("link")}
    todo = [u for u in units if (not ONLY or str(u["wp"]) in ONLY) and str(u["wp"]) not in done]
    if LIMIT:
        todo = todo[:LIMIT]
    print(f"{len(units)} units total · {len(done)} already done · {len(todo)} to process now.", flush=True)

    lock = threading.Lock()
    progress = {"n": 0}

    def process(u):
        wp = str(u["wp"]); slug = u["slug"]; code = u.get("sourceCode") or ""
        title = u.get("title") or slug
        # R2 path prefixes every Almaza folder with 'almaza-'; the committed bundle
        # stores the slug WITHOUT that prefix, so add it back.
        r2slug = slug if slug.startswith("almaza-") else f"almaza-{slug}"
        folder = sanitize(f"{title} [{code}]")
        dest = f"{REMOTE}{DEST_PARENT}/{folder}"
        tmp = tempfile.mkdtemp(prefix=f"almz_{wp}_")
        try:
            # Expected photo count from the committed bundle (verified to match the
            # DB / R2 exactly). Fetch cover + 01..(count-1), plus a small margin
            # in case R2 has extras. Retry only transient errors, never a clean 404.
            count = int(u.get("photoCount") or 0)
            upper = min((count - 1 if count else 0) + 4, MAX_PHOTOS)
            targets = [("cover.webp", "00-cover.webp")]
            targets += [(f"{k:02d}.webp", f"{k:02d}.webp") for k in range(1, upper + 1)]

            def grab(t):
                rf, lf = t
                for attempt in range(3):
                    st = fetch(f"{CDN}/{r2slug}/{rf}", os.path.join(tmp, lf))
                    if st == "ok":
                        return lf
                    if st == "404":
                        return None
                    time.sleep(0.4 * (attempt + 1))  # transient — back off + retry
                return None

            with ThreadPoolExecutor(max_workers=6) as ex:
                files = [lf for lf in ex.map(grab, targets) if lf]

            note = ""
            if not files:
                rec = {"code": code, "folder": folder, "link": None, "count": 0}
                note = "NO PHOTOS on R2"
            else:
                link = None
                if not DRY:
                    up = rclone("copy", tmp, dest, "--transfers", "12", "--no-traverse")
                    if up.returncode != 0:
                        with lock:
                            print(f"{wp} {code}: UPLOAD FAILED — {up.stderr.strip()[:160]}", flush=True)
                        return
                    lk = rclone("link", dest)
                    link = lk.stdout.strip() if lk.returncode == 0 else None
                rec = {"code": code, "folder": folder, "link": link, "count": len(files)}
                if count and len(files) < count:
                    note = f"⚠️ got {len(files)}/{count}"

            with lock:
                results[wp] = rec
                save(results)
                progress["n"] += 1
                print(f"[{progress['n']}/{len(todo)}] {wp} {code}: {rec['count']} photos "
                      f"-> {rec['link'] or note or '(dry)'}", flush=True)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=UNIT_WORKERS) as ex:
        list(ex.map(process, todo))
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
