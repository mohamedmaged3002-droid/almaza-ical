// photos-to-r2.mjs — download each unit's photos, compress to WebP, upload to the
// BlueKeys R2 bucket under {almaza-slug}/cover.webp + NN.webp (matching the
// existing BlueKeys naming convention). Writes output/r2-photos.json (wp -> [urls])
// for the gallery/sheet/DB to consume. Processes ONE unit at a time and deletes
// the temp dir after each (Mac disk is near-full).
//
// R2 creds are read from new-site/.env.local (already populated on this machine).
// Optional CLI args = wp filter, e.g. `node scripts/photos-to-r2.mjs 91001`.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config({ path: '/Users/MAGED/inv/new-site/.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UNITS = path.join(ROOT, 'output', 'units');
const MAP = path.join(ROOT, 'output', 'r2-photos.json');

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE } = process.env;
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE })) {
  if (!v) { console.error(`missing env ${k} (check new-site/.env.local)`); process.exit(1); }
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const wpFilter = process.argv.slice(2).map(Number).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// name for the i-th photo: cover.webp, then 01.webp, 02.webp, ...
const keyName = (i) => (i === 0 ? 'cover.webp' : `${String(i).padStart(2, '0')}.webp`);

async function main() {
  const map = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, 'utf8')) : {};
  let units = fs.readdirSync(UNITS)
    .map((f) => JSON.parse(fs.readFileSync(path.join(UNITS, f), 'utf8')))
    .sort((a, b) => a.wp - b.wp);
  if (wpFilter.length) units = units.filter((u) => wpFilter.includes(u.wp));

  let totalUp = 0;
  for (const u of units) {
    const photos = u.photos || [];
    if (!photos.length) { console.warn(`SKIP ${u.wp} — no photos`); continue; }
    if (Array.isArray(map[u.wp]) && map[u.wp].length === photos.length) {
      console.log(`SKIP ${u.wp} — already uploaded (${photos.length})`);
      continue;                                              // resume: don't re-hit bandwidth
    }
    const prefix = `almaza-${u.slug}`;                       // matches units.slug
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `almaza-${u.wp}-`));
    const urls = [];
    try {
      for (let i = 0; i < photos.length; i++) {
        const src = photos[i];
        let res;
        try { res = await fetch(src); } catch (e) { console.warn(`  ${u.wp} #${i} fetch err ${e.message}`); continue; }
        if (!res.ok) { console.warn(`  ${u.wp} #${i} -> ${res.status}, skipped`); continue; }
        const raw = path.join(tmp, `src-${i}`);
        fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
        const out = path.join(tmp, keyName(i));
        // compress to webp, matching the existing BlueKeys convention (1920px, q82)
        execFileSync('magick', [raw, '-auto-orient', '-resize', '1920x1920>', '-strip', '-quality', '82', out]);
        const key = `${prefix}/${keyName(i)}`;
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET, Key: key,
          Body: fs.readFileSync(out), ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        urls.push(`${R2_PUBLIC_BASE}/${key}`);
        totalUp++;
        fs.rmSync(raw); fs.rmSync(out);
      }
      map[u.wp] = urls;
      fs.writeFileSync(MAP, JSON.stringify(map, null, 2));       // checkpoint after each unit
      console.log(`OK ${u.wp} ${u.title} — ${urls.length}/${photos.length} photos -> R2`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });          // keep the disk clean
    }
    await sleep(200);
  }
  console.log(`\nDone. ${totalUp} photos uploaded. Map -> output/r2-photos.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
