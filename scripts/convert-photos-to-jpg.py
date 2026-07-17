#!/usr/bin/env python3
"""Convert every Almaza unit's Drive photos from WebP to JPG — OTAs reject WebP.

Re-downloads each unit's webp from R2 (fast Cloudflare custom domain), converts to
JPG (ImageMagick q90), and rclone-copies the JPGs into the SAME per-unit Drive
folder on maged@bluekeys.co. The folder — and therefore its share link in the OTA
sheet — is unchanged; only the file type changes. The originals are removed
afterwards by a single bulk delete (see `--include '*.webp'` step in the runbook /
commit message), so mid-run a folder briefly holds both.

Concurrency + throttle handling mirror export-photos-to-drive.py (downloads
6-parallel per unit; ~5 units at once to overlap the shared-API upload latency).
Resumable via data/jpg-converted.json. Env: ONLY=wp,wp · LIMIT=N · UNIT_WORKERS=N.
"""
import json, os, shutil, subprocess, tempfile, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUNDLE = os.path.join(ROOT, "data", "sheet-content.json")
LINKS = os.path.join(ROOT, "data", "drive-photo-links.json")
PROGRESS = os.path.join(ROOT, "data", "jpg-converted.json")
CDN = "https://photos.bluekeys.co"
REMOTE = "bluekeys:"
DEST_PARENT = "BlueKeys Photos/Almaza Unit Photos"
MAX_PHOTOS = 120
QUALITY = "90"
UNIT_WORKERS = int(os.environ.get("UNIT_WORKERS") or 5)
ONLY = set(filter(None, (os.environ.get("ONLY") or "").split(",")))
LIMIT = int(os.environ.get("LIMIT") or 0)


def fetch(url, dest):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "bluekeys-jpg"})
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


def rclone(*a):
    return subprocess.run(["rclone", *a], capture_output=True, text=True)


def main():
    units = {u["wp"]: u for u in json.load(open(BUNDLE, encoding="utf-8"))}
    links = json.load(open(LINKS, encoding="utf-8"))
    prog = json.load(open(PROGRESS, encoding="utf-8")) if os.path.exists(PROGRESS) else {}
    lock = threading.Lock()
    todo = [wp for wp in links
            if (not ONLY or wp in ONLY) and wp not in prog and links[wp].get("count", 0) > 0]
    if LIMIT:
        todo = todo[:LIMIT]
    print(f"{len(links)} units · {len(prog)} already jpg · {len(todo)} to convert now.", flush=True)
    counter = {"n": 0}

    def process(wp):
        u = units.get(int(wp))
        rec = links[wp]
        folder = rec["folder"]
        slug = u["slug"]
        r2slug = slug if slug.startswith("almaza-") else f"almaza-{slug}"
        count = int(u.get("photoCount") or 0)
        dest = f"{REMOTE}{DEST_PARENT}/{folder}"
        tmp = tempfile.mkdtemp(prefix=f"jpg_{wp}_")
        try:
            upper = min((count - 1 if count else 0) + 4, MAX_PHOTOS)
            targets = [("cover.webp", "00-cover")]
            targets += [(f"{k:02d}.webp", f"{k:02d}") for k in range(1, upper + 1)]

            def grab(t):
                rf, base = t
                webp = os.path.join(tmp, base + ".webp")
                jpg = os.path.join(tmp, base + ".jpg")
                for attempt in range(3):
                    st = fetch(f"{CDN}/{r2slug}/{rf}", webp)
                    if st == "ok":
                        cv = subprocess.run(["magick", webp, "-quality", QUALITY, jpg],
                                            capture_output=True, text=True)
                        try:
                            os.remove(webp)
                        except OSError:
                            pass
                        return base + ".jpg" if cv.returncode == 0 and os.path.exists(jpg) else None
                    if st == "404":
                        return None
                    time.sleep(0.4 * (attempt + 1))
                return None

            with ThreadPoolExecutor(max_workers=6) as ex:
                jpgs = [x for x in ex.map(grab, targets) if x]

            note = ""
            if jpgs:
                up = rclone("copy", tmp, dest, "--transfers", "12", "--no-traverse")
                if up.returncode != 0:
                    with lock:
                        print(f"{wp} {rec['code']}: UPLOAD FAILED — {up.stderr.strip()[:140]}", flush=True)
                    return
                if count and len(jpgs) < count:
                    note = f"⚠️ {len(jpgs)}/{count}"
            with lock:
                prog[wp] = {"code": rec["code"], "jpgs": len(jpgs)}
                with open(PROGRESS, "w", encoding="utf-8") as f:
                    json.dump(prog, f, indent=1, ensure_ascii=False)
                counter["n"] += 1
                print(f"[{counter['n']}/{len(todo)}] {wp} {rec['code']}: {len(jpgs)} jpg {note}", flush=True)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=UNIT_WORKERS) as ex:
        list(ex.map(process, todo))
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
