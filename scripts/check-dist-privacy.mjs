#!/usr/bin/env node
/*
  Scans a finished build for anything that must never be public.

    node scripts/check-dist-privacy.mjs [--dist dist] [--expect-none] [--addresses file.txt]

  Checks every file name and every text file (HTML, XML sitemap, JSON, JS, CSS) in the client output AND
  the server output, so structured data, Open Graph tags, alt text, URLs and the sitemap are all covered.
    - no house or unit number next to a known street, and no full internal address
    - no SharePoint or Notion links
  --expect-none  asserts a build WITHOUT fixtures: no listing pages, no demo markers, no fixture slugs.
  --addresses    extra internal addresses (one per line) to hunt for, e.g. exported from the CRM.
  Internal addresses of the fixtures are always included. Exits non-zero on any finding.
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : undefined; };
const dist = resolve(repoRoot, arg('--dist') ?? 'dist');
const expectNone = argv.includes('--expect-none');

const L = await loadTs();
const addresses = L.FIXTURE_RECORDS.map((r) => r.internal.address);
if (arg('--addresses')) addresses.push(...readFileSync(arg('--addresses'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patterns = [];
for (const addr of addresses) {
  const m = /^\s*(?:(\d+[a-z]?)\s*\/\s*)?(\d+[a-z]?)\s+([^,]+?)\s*(?:,|$)/i.exec(addr);
  if (!m) continue;
  patterns.push({ why: `house number before "${m[3]}"`, re: new RegExp(`\\b\\d+[a-z]?(?:\\s*[-/]\\s*\\d+[a-z]?)?\\s+${esc(m[3])}`, 'i') });
  patterns.push({ why: `full internal address "${addr}"`, re: new RegExp(esc(addr), 'i') });
  if (m[1]) patterns.push({ why: `unit/number ${m[1]}/${m[2]}`, re: new RegExp(`\\b${esc(m[1])}\\s*/\\s*${esc(m[2])}\\b`, 'i') });
}
patterns.push({ why: 'SharePoint link', re: /sharepoint\.com|onedrive\.live/i });
patterns.push({ why: 'Notion link', re: /notion\.(so|site)\//i });
// credentials and the Notion API host must never reach any bundle, client or server
patterns.push({ why: 'Notion token or API host', re: /NOTION_TOKEN|api\.notion\.com|\b(?:secret_|ntn_)[A-Za-z0-9]{20,}/ });
// the local draft preview must never reach a build
{
  const hit = (n) => /__local-preview__|\.local-preview/.test(n);
  const scan = (d) => { for (const n of readdirSync(d)) { const q = join(d, n); if (hit(n)) findings.push(`${relative(dist, q)}: trace of the local draft preview`); else if (statSync(q).isDirectory()) scan(q); else if (/\.(html|js|mjs|json|css|xml|txt)$/.test(n) && hit(readFileSync(q, 'utf8'))) findings.push(`${relative(dist, q)}: trace of the local draft preview`); } };
  scan(dist);
}

if (expectNone) {
  patterns.push({ why: 'demo marker', re: /demo listing|demo image|DEMO placeholder|demo-[a-z]+-(one|two|three)/i });
  for (const r of L.FIXTURE_SNAPSHOTS) patterns.push({ why: `fixture slug ${r.content.slug}`, re: new RegExp(esc(r.content.slug)) });
}

const TEXT = /\.(html|xml|json|txt|js|mjs|css|webmanifest|map)$/i;
const findings = [];
let files = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    files += 1;
    const rel = relative(dist, p);
    for (const { why, re } of patterns) if (re.test(rel)) findings.push(`${rel}: file name matches ${why}`);
    if (!TEXT.test(name)) continue;
    const body = readFileSync(p, 'utf8');
    for (const { why, re } of patterns) if (re.test(body)) findings.push(`${rel}: ${why}`);
  }
};
walk(dist);

if (expectNone) {
  const listingDirs = (() => { try { return readdirSync(join(dist, 'client/opportunities')).filter((n) => statSync(join(dist, 'client/opportunities', n)).isDirectory()); } catch { return []; } })();
  if (listingDirs.length) findings.push(`listing pages exist in a no-fixture build: ${listingDirs.join(', ')}`);
}

// Corporate office details are legitimate public contact information and must survive. The listing
// privacy rules above apply to property addresses only and must never strip or block these.
const contact = join(dist, 'client/contact-us/index.html');
try {
  const html = readFileSync(contact, 'utf8');
  for (const needle of ['Suite 34, Level 5', '33-35 Stewart Street', 'Richmond VIC 3121']) {
    if (!html.includes(needle)) findings.push(`contact-us: corporate office detail missing: "${needle}"`);
  }
} catch { /* contact page absent from this build: nothing to assert */ }

if (findings.length) {
  console.error(`check-dist-privacy: ${findings.length} finding(s) in ${files} files`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-dist-privacy: clean (${files} files scanned${expectNone ? ', no-fixture build verified' : ''}).`);
