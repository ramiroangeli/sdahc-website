#!/usr/bin/env node
/*
  Prepare approved listing photographs for the website.

    node scripts/prepare-listing-photos.mjs --in <folder of approved photos> --out <output folder>

  This is the manual, human-in-the-loop step between SharePoint and the public store:

    1. Someone copies ONLY the approved photos into "Approved for Website" (SharePoint). Originals stay
       in "Original Photos" and never leave SharePoint.
    2. Run this script on a local copy of that folder.
    3. Upload the output folder to the public store (Vercel Blob, see docs) and put the URL of the
       uploaded manifest.json into the Notion property "Web Media Manifest".
    4. A person fills in each alt text and confirms the privacy review in manifest.json before upload.

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
  for (const w of WIDTHS) {
    if (w > info.width && w !== WIDTHS[0]) continue; // never upscale
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

export async function prepareFolder(inDir, outDir, tokensPath) {
  mkdirSync(outDir, { recursive: true });
  const palette = readAccentPalette(tokensPath);
  const inputs = readdirSync(inDir).filter((f) => ACCEPT.has(extname(f).toLowerCase())).sort();
  const photos = [];
  for (const f of inputs) photos.push(await prepareOne(join(inDir, f), outDir, palette));
  const manifest = {
    version: 1,
    note: 'Fill in every alt text and set privacyReviewed to true only after checking the frame for house numbers, letterboxes, signs, number plates and identifiable people.',
    photos,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const isMain = import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
  const inDir = arg('--in');
  const outDir = arg('--out');
  if (!inDir || !outDir) {
    console.error('usage: node scripts/prepare-listing-photos.mjs --in <folder> --out <folder>');
    process.exit(2);
  }
  const root = resolve(new URL('..', import.meta.url).pathname);
  const m = await prepareFolder(resolve(inDir), resolve(outDir), join(root, 'src/styles/tokens.css'));
  console.log(`Prepared ${m.photos.length} photo(s) in ${outDir}`);
  for (const p of m.photos) console.log(`  ${p.id}  ${p.width}x${p.height}  accent=${p.accent}  files=${p.files.map((f) => f.w).join('/')}`);
  console.log('Next: fill in alt text, review each frame for privacy, set privacyReviewed, then upload the folder.');
}
