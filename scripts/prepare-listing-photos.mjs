#!/usr/bin/env node
/*
  Prepare approved listing photographs for the website.

    node scripts/prepare-listing-photos.mjs --in <folder of approved photos> --out <output folder> [--id <public id>]
    node scripts/prepare-listing-photos.mjs --verify <prepared folder>

  --id    the listing's public id (lst_..., printed by `npm run listings:preflight`). Output goes to <out>/<id>/,
          which is exactly the prefix to upload to, so the manifest ends up at <media base>/<id>/manifest.json.
  --verify  the gate before upload: checks the prepared folder is complete, reviewed and clean (see verifyFolder).

  This is the manual, human-in-the-loop step between SharePoint and the public store:

    1. Someone copies ONLY the approved photos into "Approved for Website" (SharePoint). Originals stay
       in "Original Photos" and never leave SharePoint.
    2. Run this script on a local copy of that folder.
    3. Upload the output folder to the public store (Vercel Blob, see docs) and put the URL of the
       uploaded manifest.json into the Notion property "Web Media Manifest".
    4. A person optionally fills in alt text and confirms the privacy review in manifest.json before upload.

  What it does to every image:
    - corrects orientation, then DROPS all metadata (EXIF, GPS, camera and owner fields)
    - writes three widths (480, 960, 1600) as WebP, named by a content hash, so a file name can never
      carry an address
    - samples the dominant colour and snaps it to the nearest brand accent (blue, teal, amber, slate)
      read from src/styles/tokens.css, so image masks stay on palette. No dependency is added: sharp
      already ships with Astro.
  What it cannot do: detect a house number, letterbox, sign or person in the frame. That is the human
  privacy review, recorded per photo as privacyReviewed, which defaults to false. A listing cannot be
  published while any photo is unreviewed.
*/
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const WIDTHS = [480, 960, 1600];
const ACCEPT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic']);

/** Brand accents, read from the single source of truth so they cannot drift from the site. */
export const readAccentPalette = (tokensPath) => {
  const css = readFileSync(tokensPath, 'utf8');
  const pick = (name) => {
    const m = new RegExp(`--${name}\\s*:\\s*#([0-9a-fA-F]{6})`).exec(css);
    if (!m) throw new Error(`token --${name} not found in ${tokensPath}`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  return { blue: pick('blue'), teal: pick('teal'), amber: pick('amber'), slate: pick('slate') };
};

/** Nearest brand accent to a sampled colour. Low-saturation images take the neutral accent. */
export const snapToAccent = ({ r, g, b }, palette) => {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 28) return 'slate';
  let best = 'blue';
  let bestD = Infinity;
  for (const [name, [pr, pg, pb]] of Object.entries(palette)) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
};

export async function prepareOne(file, outDir, palette) {
  const base = sharp(file, { failOn: 'error' }).rotate(); // honours EXIF orientation, then we drop EXIF
  const { data, info } = await base.clone().toBuffer({ resolveWithObject: true });
  const id = createHash('sha256').update(data).digest('hex').slice(0, 12);
  const { dominant } = await sharp(data).resize(128, 128, { fit: 'inside' }).stats();
  const files = [];
  // never upscale; but an image between two widths (say 800 px) also keeps its own full width, so it is not
  // reduced to the smallest size when the next one up does not apply
  const widths = WIDTHS.filter((w) => w <= info.width || w === WIDTHS[0]);
  if (info.width > Math.max(...widths) && info.width < WIDTHS[WIDTHS.length - 1]) widths.push(info.width);
  widths.sort((a, b) => a - b);
  for (const w of widths) {
    const name = `${id}-${w}.webp`;
    // no .withMetadata(): sharp then writes no EXIF, ICC owner fields or GPS
    await sharp(data).resize({ width: Math.min(w, info.width), withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(outDir, name));
    files.push({ w, file: name });
  }
  return {
    id,
    alt: '',
    width: info.width,
    height: info.height,
    accent: snapToAccent(dominant, palette),
    // a person sets this to true after checking the frame; false blocks publication
    privacyReviewed: false,
    files,
  };
}

/**
 * Gate before upload. Returns every problem found; empty means the folder can be uploaded.
 *  - manifest.json present, with at least one photograph
 *  - every photograph has a content-hash id, optional alt text, a recorded privacy review (true) and a known accent
 *  - every listed file exists, is a WebP named <id>-<width>.webp, and carries NO metadata (EXIF, XMP, ICC)
 *  - no image file in the folder is missing from the manifest
 */
export async function verifyFolder(dir) {
  // never trust a cached read: a file replaced since it was last opened must be re-read
  sharp.cache(false);
  const problems = [];
  const manifestPath = join(dir, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { return { ok: false, problems: ['manifest.json is missing or is not valid JSON'] }; }
  if (manifest.version !== 1 || !Array.isArray(manifest.photos) || manifest.photos.length === 0) problems.push('manifest has no photographs');
  const listed = new Set();
  for (const p of manifest.photos ?? []) {
    const tag = `photo ${p.id ?? '(no id)'}`;
    if (!/^[a-f0-9]{12}$/.test(p.id ?? '')) problems.push(`${tag}: id is not a content hash`);
    // alt text is optional (empty is fine, "Kitchen" is fine); only a non-string value or a file name is a problem
    if (typeof p.alt !== 'string') problems.push(`${tag}: alt must be text (it can be empty)`);
    else if (p.alt.trim() && /\.(jpe?g|png|webp|heic)\b|\bIMG[_-]?\d/i.test(p.alt)) problems.push(`${tag}: alt text looks like a file name`);
    if (p.privacyReviewed !== true) problems.push(`${tag}: privacy review not confirmed (privacyReviewed must be true)`);
    if (!['blue', 'teal', 'amber', 'slate'].includes(p.accent)) problems.push(`${tag}: unknown accent`);
    if (!Array.isArray(p.files) || p.files.length === 0) { problems.push(`${tag}: no files listed`); continue; }
    for (const f of p.files) {
      listed.add(f.file);
      if (f.file !== `${p.id}-${f.w}.webp`) { problems.push(`${tag}: file name ${f.file} is not <id>-<width>.webp`); continue; }
      let meta;
      try { meta = await sharp(join(dir, f.file)).metadata(); } catch { problems.push(`${tag}: ${f.file} is missing or is not a readable image`); continue; }
      if (meta.format !== 'webp') problems.push(`${tag}: ${f.file} is not WebP`);
      if (meta.exif || meta.xmp || meta.iptc || meta.icc || meta.tifftagPhotoshop) problems.push(`${tag}: ${f.file} still carries metadata (EXIF, XMP, IPTC or ICC)`);
    }
  }
  for (const name of readdirSync(dir)) if (/\.(webp|jpe?g|png|heic|tiff?)$/i.test(name) && !listed.has(name)) problems.push(`${name} is in the folder but not in the manifest`);
  return { ok: problems.length === 0, problems };
}

export async function prepareFolder(inDir, outDir, tokensPath) {
  mkdirSync(outDir, { recursive: true });
  const palette = readAccentPalette(tokensPath);
  const inputs = readdirSync(inDir).filter((f) => ACCEPT.has(extname(f).toLowerCase())).sort();
  const photos = [];
  for (const f of inputs) photos.push(await prepareOne(join(inDir, f), outDir, palette));
  const manifest = {
    version: 1,
    note: 'Alt text is optional (an empty one gets a neutral fallback). Set privacyReviewed to true only after checking the frame for house numbers, letterboxes, signs, number plates and identifiable people.',
    photos,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const isMain = import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
  const root = resolve(new URL('..', import.meta.url).pathname);
  if (arg('--verify')) {
    const r = await verifyFolder(resolve(arg('--verify')));
    if (r.ok) console.log('verify: OK. The folder is complete, reviewed and free of metadata. It can be uploaded.');
    else { console.error(`verify: ${r.problems.length} problem(s). Do NOT upload.`); for (const p of r.problems) console.error(`  - ${p}`); process.exit(1); }
    process.exit(0);
  }
  const inDir = arg('--in');
  let outDir = arg('--out');
  const id = arg('--id');
  if (!inDir || !outDir) {
    console.error('usage: node scripts/prepare-listing-photos.mjs --in <folder> --out <folder> [--id <public id>]\n       node scripts/prepare-listing-photos.mjs --verify <prepared folder>');
    process.exit(2);
  }
  if (id) {
    if (!/^lst_[a-f0-9]{10}$/.test(id)) { console.error('--id must be a public listing id such as lst_0123456789'); process.exit(2); }
    outDir = join(outDir, id);
  }
  const m = await prepareFolder(resolve(inDir), resolve(outDir), join(root, 'src/styles/tokens.css'));
  console.log(`Prepared ${m.photos.length} photo(s) in ${outDir}`);
  for (const p of m.photos) console.log(`  ${p.id}  ${p.width}x${p.height}  accent=${p.accent}  files=${p.files.map((f) => f.w).join('/')}`);
  console.log('Next: optionally add alt text, and set privacyReviewed to true after checking each frame, then run --verify, then upload the folder.');
}
