// Usage: node scripts/prepare-team-photo.mjs <input image> <slug>
// Crops the photo to a 1:1 square at the top centre (where the face usually is) and writes 800 px AVIF, WebP and JPG files to
// public/images/team/<slug>.{avif,webp,jpg}. Then set "photo": "<slug>" in src/content/team.json and check the crop on the page.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const [, , input, slug] = process.argv;
if (!input || !slug) { console.error('Usage: node scripts/prepare-team-photo.mjs <input image> <slug>'); process.exit(1); }
mkdirSync('public/images/team', { recursive: true });
const base = () => sharp(input).rotate().resize(800, 800, { fit: 'cover', position: 'top' });
await base().avif({ quality: 55 }).toFile(`public/images/team/${slug}.avif`);
await base().webp({ quality: 78 }).toFile(`public/images/team/${slug}.webp`);
await base().jpeg({ quality: 82, mozjpeg: true }).toFile(`public/images/team/${slug}.jpg`);
console.log(`public/images/team/${slug}.{avif,webp,jpg} written`);
