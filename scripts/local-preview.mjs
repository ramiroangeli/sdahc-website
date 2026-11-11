#!/usr/bin/env node
/*
  Strictly local draft preview of ONE real listing. It is not part of the publication path.

    npm run listings:preview -- <notionPageId>     read the page (read only) and write .local-preview/draft.json
    npm run listings:preview -- --clear            delete .local-preview/
    npm run dev:preview                            astro dev with the preview listing on http://127.0.0.1:4321/opportunities/

  What it writes: only the public draft (title, description, public address, pricing mode, category, photos)
  to .local-preview/, which is git-ignored. No snapshot, no approver, no status change, nothing in
  src/data/listings/approved/. Internal fields (house number, price, yield, SharePoint link) are read only to
  check the draft for leaks and are never written.
  The draft is shown only by `astro dev` with LISTINGS_LOCAL_PREVIEW=1 (see src/data/listings/index.ts). A
  production build never reads .local-preview/ and `npm run check:privacy` fails if it finds a trace of it.

  Photos: put the prepared folder (npm run listings:photos -- --id <lst_id> --out .local-preview/media) at
  .local-preview/media/<lst_id>/ and fill alt text and privacyReviewed in its manifest.json. Without it, the
  listing shows its "photography to follow" state.
*/
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

const dir = join(repoRoot, '.local-preview');
const argv = process.argv.slice(2);
if (argv.includes('--clear')) { rmSync(dir, { recursive: true, force: true }); console.log('Removed .local-preview/'); process.exit(0); }

const pageId = argv.find((a) => !a.startsWith('--'));
if (!pageId) { console.error('Usage: npm run listings:preview -- <notionPageId>   (or --clear)'); process.exit(2); }

const L = await loadTs();
let cfg;
try { cfg = L.readNotionConfig(process.env); } catch (e) { console.error(`listings:preview: ${e.message}`); process.exit(1); }
const page = await new L.NotionReadClient(cfg).retrievePage(pageId);

const BASE = '/__local-preview__';
const id = L.publicIdFor(page.id);
const mediaManifest = join(dir, 'media', id, 'manifest.json');
let photos = [];
const photoIssues = [];
if (existsSync(mediaManifest)) {
  const origin = 'http://local.invalid';
  const r = L.manifestToPhotos(JSON.parse(readFileSync(mediaManifest, 'utf8')), `${origin}${BASE}/${id}/manifest.json`, `${origin}${BASE}`);
  photoIssues.push(...r.issues);
  photos = r.photos.map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v, src: v.src.slice(origin.length) })) }));
}

const { record, issues } = L.pageToRecord(page, { photos });
if (!record.draft) { console.error(`No draft could be built:\n  - ${issues.join('\n  - ')}`); process.exit(1); }

const leaks = L.checkPublicSafety(record.draft, {
  allowDemo: false, mediaBaseUrl: BASE,
  internalAddress: record.internal.address, internalPriceAud: record.internal.priceAud, internalYieldPct: record.internal.yieldPct,
});
if (leaks.length) { console.error(`The draft is not safe to show:\n  - ${leaks.join('\n  - ')}`); process.exit(1); }

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'draft.json'), JSON.stringify({ id, webStatus: record.webStatus, readAt: new Date().toISOString(), content: record.draft }, null, 2), { mode: 0o600 });

console.log(`Preview draft written for ${id} (Notion status: ${record.webStatus}; nothing in Notion or git changed).`);
console.log(`  title:     ${record.draft.title}`);
console.log(`  address:   ${record.draft.address.street ?? ''} ${record.draft.address.suburb} ${record.draft.address.state} ${record.draft.address.postcode}`.replace(/\s+/g, ' '));
console.log(`  pricing:   ${record.draft.pricing.mode}`);
console.log(`  category:  ${(record.draft.sda.designCategories ?? []).join(', ') || '(none)'}`);
console.log(`  photos:    ${photos.length}${photoIssues.length ? ` (skipped: ${photoIssues.join('; ')})` : ''}`);
if (issues.length) console.log(`  notes:     ${issues.join('; ')}`);
console.log('\nLaunch: npm run dev:preview   then open http://127.0.0.1:4321/opportunities/');
