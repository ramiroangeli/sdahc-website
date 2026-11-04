#!/usr/bin/env node
/*
  Verifies that a withdrawn listing is really gone from a finished build.

    node scripts/check-withdrawal.mjs <slug|id> [--dist dist]

  Run after `npm run build` (or `LISTINGS_FIXTURES=1 npx astro build` when testing with fixtures). It fails if
  the build still contains, in the client OR server output:
    - the listing's page (route)
    - its catalogue or hero entry, any internal link to it, its canonical or Open Graph URL, its JSON-LD
    - its sitemap reference
    - any file named after it
  and it confirms the explicit withdrawal file exists. A passing result means THIS BUILD is clean; the
  production site is clean only after that build is deployed (see "Emergency withdrawal" in the runbook).
*/
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

const argv = process.argv.slice(2);
const distIdx = argv.indexOf('--dist');
const distArg = distIdx > -1 ? argv[distIdx + 1] : 'dist';
const target = argv.find((a, i) => !a.startsWith('--') && !(distIdx > -1 && i === distIdx + 1));
if (!target) { console.error('usage: node scripts/check-withdrawal.mjs <slug|id> [--dist dist]'); process.exit(2); }
const dist = resolve(repoRoot, distArg);

const L = await loadTs();
const readDir = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(d, f), 'utf8'))) : []);
const snaps = [...readDir(join(repoRoot, 'src/data/listings/approved')), ...L.FIXTURE_SNAPSHOTS];
const snap = snaps.find((s) => s.listingId === target || s.content.slug === target);
if (!snap) { console.error(`No listing found for "${target}".`); process.exit(1); }
const slug = snap.content.slug;
const id = snap.listingId;

const findings = [];
const tomb = join(repoRoot, 'src/data/listings/withdrawn', `${id}.json`);
if (!existsSync(tomb)) findings.push(`no explicit withdrawal file at src/data/listings/withdrawn/${id}.json`);

const TEXT = /\.(html|xml|json|txt|js|mjs|css|webmanifest|map)$/i;
let files = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(dist, p);
    if (statSync(p).isDirectory()) { if (name === slug) findings.push(`route still built: ${rel}`); walk(p); continue; }
    files += 1;
    if (rel.includes(slug)) findings.push(`file named after the listing: ${rel}`);
    if (!TEXT.test(name)) continue;
    const body = readFileSync(p, 'utf8');
    if (body.includes(`/opportunities/${slug}`)) findings.push(`${rel}: links to or names the listing URL (catalogue, hero, sitemap, canonical, JSON-LD or Open Graph)`);
    else if (body.includes(slug)) findings.push(`${rel}: mentions the listing slug`);
    if (body.includes(id)) findings.push(`${rel}: contains the listing id`);
  }
};
if (!existsSync(dist)) { console.error(`No build output at ${dist}. Build first.`); process.exit(2); }
walk(dist);

if (findings.length) {
  console.error(`check-withdrawal: ${slug} is NOT fully removed (${findings.length} finding(s) in ${files} files)`);
  for (const f of [...new Set(findings)]) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-withdrawal: ${slug} is absent from the build (${files} files scanned): no route, catalogue or hero entry, internal link, sitemap reference, canonical, JSON-LD or file.`);
