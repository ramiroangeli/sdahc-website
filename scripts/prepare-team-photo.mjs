// Usage: node scripts/prepare-team-photo.mjs <input image> <slug> [top]
// Crops the photo to a 1:1 square, centred across and starting [top] px from the top (default 0, where the face usually is; use it to leave
// some air above the head when the photo has a lot of wall or sky), and writes 800 px AVIF, WebP and JPG files to
// public/images/team/<slug>.{avif,webp,jpg}. Then set "photo": "<slug>" in src/content/team.json and check the crop on the page.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const [, , input, slug, topArg] = process.argv;
if (!input || !slug) { console.error('Usage: node scripts/prepare-team-photo.mjs <input image> <slug> [top]'); process.exit(1); }
mkdirSync('public/images/team', { recursive: true });
const top = Number(topArg || 0);
const meta = await sharp(input).rotate().metadata();
const side = Math.min(meta.width, meta.height - top);
const base = () => sharp(input).rotate().extract({ left: Math.round((meta.width - side) / 2), top, width: side, height: side }).resize(800, 800);
await base().avif({ quality: 55 }).toFile(`public/images/team/${slug}.avif`);
await base().webp({ quality: 78 }).toFile(`public/images/team/${slug}.webp`);
await base().jpeg({ quality: 82, mozjpeg: true }).toFile(`public/images/team/${slug}.jpg`);
console.log(`public/images/team/${slug}.{avif,webp,jpg} written`);
