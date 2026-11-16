// After a build: the catalogue in the built output lists the public properties in exactly the order the saved display order and the featured
// rule produce. Reads only committed files and the build output; nothing private. Usage: node scripts/check-display-order.mjs [--dist <dir>]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';
import { slugsInCatalogue } from './lib/publish-git.mjs';

const i = process.argv.indexOf('--dist');
const dist = join(repoRoot, i > -1 ? process.argv[i + 1] : '.vercel/output/static');
const page = join(dist, 'opportunities/index.html');
if (!existsSync(page)) { console.error(`check-display-order: no built catalogue at ${page} (run the build first)`); process.exit(2); }

const L = await loadTs();
const dir = (d) => { const p = join(repoRoot, 'src/data/listings', d); return existsSync(p) ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(p, f), 'utf8'))) : []; };
const withdrawn = new Set(dir('withdrawn').map((w) => w.listingId));
const order = L.parseDisplayOrder(JSON.parse(readFileSync(join(repoRoot, 'src/data/listings/display-order.json'), 'utf8'))).order;
const visible = dir('approved').filter((s) => !withdrawn.has(s.listingId)).map((s) => ({ id: s.listingId, slug: s.content.slug, title: s.content.title, featured: s.featured === true, publishedAt: s.firstPublishedAt }));
const expected = L.orderListings(visible, order).map((l) => l.slug);
const built = slugsInCatalogue(readFileSync(page, 'utf8'));
const ok = JSON.stringify(built) === JSON.stringify(expected);
console.log(`check-display-order: ${ok ? 'OK' : 'MISMATCH'} (${built.length} listings in the built catalogue, ${expected.length} expected)`);
if (!ok) { console.log(`  built:    ${built.join(' > ')}\n  expected: ${expected.join(' > ')}`); process.exit(1); }
