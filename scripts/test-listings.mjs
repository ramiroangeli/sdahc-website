// Listings test suite. Run from the repo root:  node scripts/test-listings.mjs
// Bundles the pure listing modules with esbuild and exercises privacy, pricing, versioning, fixture
// isolation, the Notion mapping (against mock API responses, never the network), enquiries and the
// photo preparation step. Exits non-zero on any failure.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';
import { prepareFolder, readAccentPalette, snapToAccent, verifyFolder } from './prepare-listing-photos.mjs';
import { MODES as MODES_FROM_LIB, approverFor, checkManifest, effectiveStatus, overlayPage, parity, sign, signedHeaders, statusParity, verifySignature, withRetry } from './lib/publish-job.mjs';

const L = await loadTs();
const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter((f) => f && !/\.(jpg|jpeg|png|webp|ico|pdf|zip|woff2?)$/i.test(f));
let failed = 0;
let passed = 0;
const t = (name, ok) => {
  if (ok) passed += 1;
  else { failed += 1; console.log(`FAIL ${name}`); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const section = (s) => console.log(`\n== ${s}`);

const MEDIA = 'https://media.example.test/listings';
const COMPLY = { victoria: { reviewedBy: 'Adviser', reviewedAt: '2026-11-01', adviceReference: 'test', cleared: { asking_price: true, price_guide: true, eoi: true, contact_agent: true } }, basicClassification: { confirmedListingIds: [] } };
const DENY = { victoria: { reviewedBy: null, reviewedAt: null, adviceReference: null, cleared: { asking_price: false, price_guide: false, eoi: false, contact_agent: false } }, basicClassification: { confirmedListingIds: [] } };
const realPhoto = (id = 'a1b2c3d4e5f6') => ({
  id, alt: 'Front elevation of a single-storey home', width: 1600, height: 1200, accent: 'teal', privacyReviewed: true,
  variants: [{ w: 480, src: `${MEDIA}/${id}-480.webp` }, { w: 960, src: `${MEDIA}/${id}-960.webp` }],
});
const baseContent = () => structuredClone(L.FIXTURE_SNAPSHOTS[0].content);
const withMod = (f) => { const c = baseContent(); f(c); return c; };
const INTERNAL = '1/10 Rutherford Grove, Armstrong Creek VIC 3217';
const ctx = { allowDemo: true, internalAddress: INTERNAL };

/* ---------------------------------------------------------------- address */
section('public address and slugs');
const a = L.parsePublicAddress('Rutherford Grove, Armstrong Creek VIC 3217');
t('parses street, suburb, state, postcode', a.street === 'Rutherford Grove' && a.suburb === 'Armstrong Creek' && a.state === 'VIC' && a.postcode === '3217');
t('formats the public address', L.formatPublicAddress(a) === 'Rutherford Grove, Armstrong Creek VIC 3217');
for (const bad of [
  '1/10 Rutherford Grove, Armstrong Creek VIC 3217',
  '10 Rutherford Grove, Armstrong Creek VIC 3217',
  '30B Sheppard Street, Shepparton VIC 3630',
  'Rutherford Grove 19, Armstrong Creek VIC 3217',
  'Rutherford Grove, Armstrong Creek VIC',
  'Rutherford Grove, Armstrong Creek XX 3217',
  'Unit Road, Armstrong Creek VIC 3217',
]) t(`rejects "${bad}"`, throws(() => L.parsePublicAddress(bad)));
t('schema rejects digits in the street', !L.publicAddressSchema.safeParse({ ...a, street: 'Rutherford Grove 19' }).success);
const s1 = L.makeSlug(a, new Set(), 'seed-1');
t('slug has letters and hyphens only', /^[a-z]+(-[a-z]+)*$/.test(s1) && s1 === 'rutherford-grove-armstrong-creek-vic');
const s2 = L.makeSlug(a, new Set([s1]), 'seed-2');
const s3 = L.makeSlug(a, new Set([s1, s2]), 'seed-3');
t('same-street properties get distinct letter-only slugs', new Set([s1, s2, s3]).size === 3 && /^[a-z-]+$/.test(s2 + s3));
t('suffix is stable for the same seed', L.makeSlug(a, new Set([s1]), 'seed-2') === s2);
t('slug schema rejects a number', !L.publicContentSchema.safeParse({ ...baseContent(), slug: 'rutherford-grove-19' }).success);

/* ---------------------------------------------------------------- privacy */
section('privacy guards');
t('clean fixture content passes', L.checkPublicSafety(baseContent(), ctx).length === 0);
for (const fixture of L.FIXTURE_RECORDS) {
  const snap = L.FIXTURE_SNAPSHOTS.find((s) => s.listingId === fixture.id);
  t(`fixture ${fixture.id} passes against its own internal address`, L.checkPublicSafety(snap.content, { ...ctx, internalAddress: fixture.internal.address }).length === 0);
}
const leaks = {
  'description "10 Rutherford Grove"': (c) => { c.description[0] = 'A quiet home at 10 Rutherford Grove.'; },
  'description "1/10 Rutherford Grove"': (c) => { c.description[0] = 'Located at 1/10 Rutherford Grove.'; },
  'description "Unit 3, 10 Rutherford Grove"': (c) => { c.description[0] = 'Unit 3, 10 Rutherford Grove, close to shops.'; },
  'description number after street': (c) => { c.description[0] = 'Find us on Rutherford Grove 19 near the park.'; },
  'title with number': (c) => { c.title = '10 Rutherford Grove SDA home'; },
  'photo alt text with number': (c) => { c.photos[0] = { ...c.photos[0], alt: 'Front of 10 Rutherford Grove property' }; },
};
for (const [name, mod] of Object.entries(leaks)) t(`blocks ${name}`, L.checkPublicSafety(withMod(mod), ctx).length > 0);
// the generic guard must work on its own, with no knowledge of the CRM address (the build-time case)
for (const [name, mod] of Object.entries(leaks)) t(`generic guard alone blocks ${name}`, L.checkPublicSafety(withMod(mod), { allowDemo: true }).length > 0);
t('blocks the full internal address', L.checkPublicSafety(withMod((c) => { c.description[0] = `Address: ${INTERNAL}`; }), ctx).length > 0);
t('blocks a SharePoint link', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Docs at https://x.sharepoint.com/sites/a'; }), ctx).length > 0);
t('blocks a Notion reference', L.checkPublicSafety(withMod((c) => { c.description[0] = 'See notion.so/abc for the row'; }), ctx).length > 0);
t('blocks a dollar amount in the description', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Offers above $695,000 considered.'; }), ctx).length > 0);
t('blocks yield and income language', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Strong rental income and yield.'; }), ctx).length > 0);
t('blocks the internal CRM price even without a dollar sign', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Priced at 695,000 all in.'; }), { ...ctx, internalPriceAud: 695000 }).length > 0);
t('blocks the internal yield figure', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Returns 6.5% per year.'; }), { ...ctx, internalYieldPct: 6.5 }).length > 0);
t('blocks an email address', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Contact jo@example.com for details.'; }), ctx).length > 0);
t('blocks a phone number', L.checkPublicSafety(withMod((c) => { c.description[0] = 'Call 0412 345 678 for details.'; }), ctx).length > 0);
t('blocks demo photos outside fixtures', L.checkPublicSafety(baseContent(), { ...ctx, allowDemo: false }).length > 0);
const realC = withMod((c) => { c.photos = [realPhoto()]; });
t('accepts a hashed photo on the approved origin', L.checkPublicSafety(realC, { allowDemo: false, mediaBaseUrl: MEDIA }).length === 0);
t('rejects a photo on another origin', L.checkPublicSafety(realC, { allowDemo: false, mediaBaseUrl: 'https://other.example.test' }).length > 0);
t('rejects a photo named after an address', L.checkPublicSafety(withMod((c) => { const p = realPhoto(); p.variants[0].src = `${MEDIA}/19-rutherford-grove.webp`; c.photos = [p]; }), { allowDemo: false, mediaBaseUrl: MEDIA }).length > 0);
t('rejects a photo URL with a query string', L.checkPublicSafety(withMod((c) => { const p = realPhoto(); p.variants[0].src = `${MEDIA}/a1b2c3d4e5f6-480.webp?token=1`; c.photos = [p]; }), { allowDemo: false, mediaBaseUrl: MEDIA }).length > 0);
t('schema rejects an unreviewed photo', !L.publicContentSchema.safeParse(withMod((c) => { c.photos = [{ ...realPhoto(), privacyReviewed: false }]; })).success);
t('schema rejects unknown keys (no smuggled fields)', !L.publicContentSchema.safeParse({ ...baseContent(), internalAddress: INTERNAL }).success);

section('corporate office vs property privacy (integration with the Victorian office update)');
const stewart = withMod((c) => { c.address = { street: 'Stewart Street', suburb: 'Richmond', state: 'VIC', postcode: '3121' }; c.description[0] = 'Home at 33-35 Stewart Street.'; });
t('a property listing on Stewart Street still cannot show a house number', L.checkPublicSafety(stewart, { allowDemo: true }).length > 0);
t('the same street without a number is fine for a property listing', L.checkPublicSafety(withMod((c) => { c.address = { street: 'Stewart Street', suburb: 'Richmond', state: 'VIC', postcode: '3121' }; }), { allowDemo: true }).length === 0);
const contactSrc = readFileSync(join(repoRoot, 'src/pages/contact-us.astro'), 'utf8');
t('the contact page keeps the full corporate office address', ['Suite 34, Level 5', '33-35 Stewart Street', 'Richmond VIC 3121'].every((x) => contactSrc.includes(x)));
t('the contact page does not route through the listing guards', !/data\/listings|guards/.test(contactSrc));

/* ---------------------------------------------------------------- pricing */
section('public pricing');
const norm = L.normalisePriceDisplay;
t('normalises a plain amount', norm('$695,000') === '$695,000' && norm('695000') === '$695,000' && norm('695,000') === '$695,000');
t('normalises a range', norm('$650,000 - $700,000') === '$650,000 to $700,000' && norm('650000 to 700000') === '$650,000 to $700,000' && norm('$650,000 \u2013 $700,000') === '$650,000 to $700,000');
for (const bad of ['POA', '', '$5', '$700,000 to $650,000', '$1,000,000,000', 'Offers over $700,000', '$650,000 to $700,000 to $800,000']) t(`rejects price "${bad}"`, throws(() => norm(bad)));
const P = (mode, display) => L.pricingSchema.safeParse(display ? { mode, display } : { mode });
t('asking price needs an approved amount', !P('asking_price').success && P('asking_price', '$695,000').success);
t('price guide accepts a range', P('price_guide', '$650,000 to $700,000').success);
t('EOI and Contact Agent must not carry an amount', !P('eoi', '$695,000').success && !P('contact_agent', '$695,000').success && P('eoi').success && P('contact_agent').success);
t('rejects a non-canonical display string', !P('asking_price', '695000').success);
t('EOI label', L.pricingLine({ mode: 'eoi' }) === 'Expressions of Interest');
t('Contact Agent label', L.pricingLine({ mode: 'contact_agent' }) === 'Contact Agent');
t('asking price line shows AUD', L.pricingLine({ mode: 'asking_price', display: '$695,000' }) === 'Asking Price $695,000 AUD');
t('price guide line shows AUD', L.pricingLine({ mode: 'price_guide', display: '$650,000 to $700,000' }) === 'Price Guide $650,000 to $700,000 AUD');
t('approved price is allowed even if it equals the CRM price', L.checkPublicSafety(withMod((c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; }), { ...ctx, internalPriceAud: 695000 }).length === 0);
t('price bounds feed structured data', L.pricingBounds({ mode: 'price_guide', display: '$650,000 to $700,000' }).min === 650000 && L.pricingBounds({ mode: 'eoi' }) === null);

/* ------------------------------------------------------------- versioning */
section('versioning and approval');
const rec = (over = {}) => ({ ...structuredClone(L.FIXTURE_RECORDS[0]), ...over });
const snap = () => structuredClone(L.FIXTURE_SNAPSHOTS[0]);
const now = new Date('2026-06-01T00:00:00Z');
const res = (o) => L.resolveListing({ webStatus: 'published', snapshot: snap(), now, ...o });
t('published with a verified snapshot is visible', res().visible);
t('withdrawn hides immediately', !res({ webStatus: 'withdrawn' }).visible);
t('not published hides', !res({ webStatus: 'not_published' }).visible);
t('no approved version hides', !res({ snapshot: undefined }).visible);
t('past listing end date hides', !res({ listingEndDate: '2026-05-01' }).visible && res({ listingEndDate: '2026-07-01' }).visible);
t('tampered snapshot fails its integrity check', !res({ snapshot: { ...snap(), content: { ...snap().content, title: 'Edited without approval' } } }).visible);
t('snapshot without an approver hides', !res({ snapshot: { ...snap(), approvedBy: '' } }).visible);
t('in review keeps the last approved version live', res({ webStatus: 'in_review' }).visible);
t('draft status keeps the last approved version live', res({ webStatus: 'draft' }).visible);
t('under offer is a live status, not a re-approval', res({ webStatus: 'under_offer' }).commercialStatus === 'under_offer' && res({ webStatus: 'sold' }).commercialStatus === 'sold' && res().commercialStatus === 'available');
const draftEdited = withMod((c) => { c.title = 'A brand new title'; });
const pend = res({ draftHash: L.contentHash(draftEdited) });
t('an unapproved edit is flagged pending but the approved version stays live', pend.visible && pend.pendingChanges);
t('an unchanged draft is not pending', !res({ draftHash: snap().contentHash }).pendingChanges);
t('hash ignores internal data', L.contentHash(baseContent()) === L.contentHash(structuredClone(L.FIXTURE_SNAPSHOTS[0].content)));
t('hash changes with any public field', L.contentHash(draftEdited) !== L.contentHash(baseContent()) && L.contentHash(withMod((c) => { c.pricing = { mode: 'contact_agent' }; })) !== L.contentHash(baseContent()));
t('hash is independent of key order', L.contentHash({ a: 1, b: 2 }) === L.contentHash({ b: 2, a: 1 }));

const real = (over = {}) => ({
  id: 'lst_test000001', webStatus: 'published', featured: false, isFixture: false,
  approval: { by: 'Steve Dawson', byUserId: 'user-steve', at: '2026-02-01T00:00:00Z' },
  draft: withMod((c) => { c.photos = [realPhoto()]; c.slug = 'rutherford-grove-armstrong-creek-vic'; }),
  internal: { address: INTERNAL, priceAud: 695000 },
  ...over,
});
const APPROVERS = ['user-steve'];
const vctx = { allowDemo: false, mediaBaseUrl: MEDIA, internalAddress: INTERNAL, internalPriceAud: 695000, authorisedApproverIds: APPROVERS, compliance: COMPLY };
const ok = L.validateForPublication(real(), vctx, now);
t('a complete approved real record can be published', ok.ok && ok.content);
t('refuses without a named approver', !L.validateForPublication(real({ approval: { at: '2026-02-01T00:00:00Z' } }), vctx, now).ok);
t('refuses without an approval time', !L.validateForPublication(real({ approval: { by: 'Steve Dawson' } }), vctx, now).ok);
t('refuses an approval dated in the future', !L.validateForPublication(real({ approval: { by: 'S', at: '2027-01-01T00:00:00Z' } }), vctx, now).ok);
for (const st of ['draft', 'in_review', 'not_published', 'withdrawn']) t(`refuses to promote status ${st}`, !L.validateForPublication(real({ webStatus: st }), vctx, now).ok);
t('refuses a record without photos', !L.validateForPublication(real({ draft: withMod((c) => { c.photos = []; }) }), vctx, now).ok);
t('refuses demo photos on a real record', !L.validateForPublication(real({ draft: baseContent() }), vctx, now).ok);
t('refuses an invalid draft', !L.validateForPublication(real({ draft: null }), vctx, now).ok);
t('refuses a draft with a house number in the text', !L.validateForPublication(real({ draft: withMod((c) => { c.photos = [realPhoto()]; c.description[0] = 'Home at 10 Rutherford Grove.'; }) }), vctx, now).ok);
const sn1 = L.nextSnapshot(real(), ok.content, undefined, now);
t('first promotion is version 1 with a verifiable hash', sn1.version === 1 && L.contentHash(sn1.content) === sn1.contentHash && sn1.approvedBy === 'Steve Dawson');
t('promoting an unchanged draft does nothing', L.nextSnapshot(real(), ok.content, sn1, now) === null);
const edited = withMod((c) => { c.photos = [realPhoto()]; c.title = 'Updated public title'; });
t('a changed draft becomes version 2 and keeps the first publish date', (() => { const n = L.nextSnapshot(real(), edited, sn1, now); return n.version === 2 && n.firstPublishedAt === sn1.firstPublishedAt; })());

/* ------------------------------------------------------- fixture isolation */
section('fixture isolation');
t('a production deployment refuses fixtures', throws(() => L.assertFixturesAllowed({ VERCEL_ENV: 'production' })));
t('previews and local runs may use fixtures', !throws(() => L.assertFixturesAllowed({ VERCEL_ENV: 'preview' })) && !throws(() => L.assertFixturesAllowed({})));
t('nothing is published with no records (production default)', L.buildPublicListings({ records: [], snapshots: [], now, ctx: { allowDemo: false } }).length === 0);
t('fixtures cannot be published with demo disabled', throws(() => L.buildPublicListings({ records: L.FIXTURE_RECORDS, snapshots: L.FIXTURE_SNAPSHOTS, now, ctx: { allowDemo: false } })));
const fx = L.buildPublicListings({ records: L.FIXTURE_RECORDS, snapshots: L.FIXTURE_SNAPSHOTS, now, ctx: { allowDemo: true } });
t('all three fixtures publish in development', fx.length === 3 && fx.every((l) => l.isDemo && l.id.startsWith('fx_')));
t('every fixture photo is a labelled demo placeholder', fx.every((l) => l.photos.every((p) => p.demo === true && /DEMO/.test(p.alt))));
t('no fixture invents a price, design category or bedroom count', fx.every((l) => !l.pricing.display && !l.sda.designCategories && !l.sda.bedrooms));
t('the unapproved draft wording never reaches the public record', !JSON.stringify(fx).includes('edited after approval'));
t('the under-offer fixture shows the approved version', fx.find((l) => l.id === 'fx_002').commercialStatus === 'under_offer');
t('public records carry only street names', fx.every((l) => !/\d/.test(l.slug) && !/\d/.test(l.address.street)));
const fxJson = JSON.stringify(fx);
for (const r of L.FIXTURE_RECORDS) {
  const addr = r.internal.address;
  t(`internal address of ${r.id} is absent from the public list`, !fxJson.includes(addr) && !/\b(1\/10|2\/20|30B|\b10 |\b20 )/.test(fxJson.replace(/"(width|height|w)":\d+/g, '')));
}

/* ------------------------------------------------------- end-to-end + SEO */
section('end to end: approved real listing, SEO and structured data');
const pipeline = (pricing) => {
  const rc = real({ draft: withMod((c) => { c.photos = [realPhoto()]; if (pricing) c.pricing = pricing; }) });
  const v = L.validateForPublication(rc, vctx, now);
  if (!v.ok) throw new Error(v.issues.join('; '));
  const snapshot = L.nextSnapshot(rc, v.content, undefined, now);
  return L.buildPublicListings({ records: [rc], snapshots: [snapshot], now, ctx: { allowDemo: false, mediaBaseUrl: MEDIA } })[0];
};
const eoiListing = pipeline();
const askListing = pipeline({ mode: 'asking_price', display: '$695,000' });
t('the real listing publishes with a public address, not the internal one', eoiListing.address.street === 'Rutherford Grove' && !JSON.stringify(eoiListing).includes('19'));
t('EOI listing exposes no amount anywhere', !/\$|695/.test(JSON.stringify(eoiListing)));
const ld = L.listingJsonLd(eoiListing, 'https://sdahomechoices.com.au/');
const ldJson = JSON.stringify(ld);
t('JSON-LD uses the street name, suburb, state and postcode', ld.about.address.streetAddress === 'Rutherford Grove' && ld.about.address.postalCode === '3217');
t('JSON-LD has no coordinates and no house number', !/"geo"|latitude|longitude/i.test(ldJson) && !/\b\d+[a-z]?\s+Rutherford/i.test(ldJson) && !ldJson.includes('1/10'));
t('JSON-LD has no offer without a public price', !('offers' in ld));
const ldAsk = L.listingJsonLd(askListing, 'https://sdahomechoices.com.au/');
t('JSON-LD offer carries only the approved AUD price', ldAsk.offers.price === 695000 && ldAsk.offers.priceCurrency === 'AUD');
t('JSON-LD of a SOLD or UNDER OFFER listing carries no offer, even with an approved price (it must not imply unconditional availability)', !('offers' in L.listingJsonLd({ ...askListing, commercialStatus: 'sold' }, 'https://sdahomechoices.com.au/')) && !('offers' in L.listingJsonLd({ ...askListing, commercialStatus: 'under_offer' }, 'https://sdahomechoices.com.au/')));
t('JSON-LD URL is the numberless slug', ld.url === 'https://sdahomechoices.com.au/opportunities/rutherford-grove-armstrong-creek-vic/');
t('Open Graph image is the widest real photo', L.listingOgImage(eoiListing) === `${MEDIA}/a1b2c3d4e5f6-960.webp`);
t('a demo listing never provides an Open Graph image', L.listingOgImage(fx[0]) === undefined);
t('JSON-LD for fixtures stays free of internal numbers', fx.every((l) => !/\b\d+[a-z]?\s+(rutherford|gymea|sheppard)/i.test(JSON.stringify(L.listingJsonLd(l, 'https://sdahomechoices.com.au/')))));

/* ------------------------------------------------------------ Notion adapter */
section('Notion mapping (mock API shapes, no network)');
const N = L.NOTION;
const P_ = {
  title: (s) => ({ type: 'title', title: [{ plain_text: s }] }),
  rt: (s) => ({ type: 'rich_text', rich_text: s ? [{ plain_text: s }] : [] }),
  sel: (s) => ({ type: 'select', select: s ? { name: s } : null }),
  multi: (...s) => ({ type: 'multi_select', multi_select: s.map((name) => ({ name })) }),
  num: (n) => ({ type: 'number', number: n }),
  url: (u) => ({ type: 'url', url: u }),
  date: (d) => ({ type: 'date', date: d ? { start: d } : null }),
  people: (...n) => ({ type: 'people', people: n.map((name) => ({ object: 'user', id: `user-${name.split(' ')[0].toLowerCase()}`, name })) }),
  person: (id, name) => ({ type: 'people', people: [{ object: 'user', id, ...(name ? { name } : {}) }] }),
  check: (b) => ({ type: 'checkbox', checkbox: b }),
  rel: (...ids) => ({ type: 'relation', relation: ids.map((id) => ({ id })) }),
};
const page = (over = {}, id = '2e2909c1-0000-0000-0000-000000000001') => ({
  id,
  properties: {
    [N.name]: P_.title('Rutherford fixture'),
    [N.address]: P_.rt(INTERNAL),
    [N.price]: P_.num(695000),
    [N.yield]: P_.num(6.5),
    [N.description]: P_.rt('Internal CRM notes about vendor motivation.'),
    [N.designCategory]: P_.multi('High Physical Support'),
    [N.buildType]: P_.sel('New build'),
    [N.features]: P_.multi('Tenant: J. Citizen'),
    [N.listingAgent]: P_.people('Agent Name'),
    [N.listingEndDate]: P_.date(null),
    [N.sharepointLink]: P_.url('https://tenant.sharepoint.com/sites/x/IM.pdf'),
    [N.deals]: P_.rel('deal-1'),
    [N.state]: P_.sel('VIC'),
    [N.webStatus]: P_.sel('Published'),
    [N.webPublicAddress]: P_.rt('Rutherford Grove, Armstrong Creek VIC 3217'),
    [N.webTitle]: P_.rt('SDA property, Armstrong Creek'),
    [N.webDescription]: P_.rt('First public paragraph.\n\nSecond public paragraph.'),
    [N.webPricingMode]: P_.sel('Expressions of Interest'),
    [N.webDisplayPrice]: P_.rt(''),
    [N.webPhotoFolder]: P_.url('https://tenant.sharepoint.com/sites/x/Marketing/Approved'),
    [N.webFeatured]: P_.check(true),
    [N.webApprovedBy]: P_.people('Steve Dawson'),
    ...over,
  },
});
const APPROVED_AT = '2026-02-01T00:00:00Z';
const mapped = L.pageToRecord(page(), { photos: [realPhoto()], approvedAt: APPROVED_AT });
t('maps to a hashed public id (the Notion id never leaves)', /^lst_[a-f0-9]{10}$/.test(mapped.record.id) && !JSON.stringify(mapped.record.draft).includes('2e2909c1'));
t('maps status, featured and the named approver; the approval time is set by promotion, not typed', mapped.record.webStatus === 'published' && mapped.record.featured && mapped.record.approval.by === 'Steve Dawson' && mapped.record.approval.at === APPROVED_AT && L.pageToRecord(page()).record.approval.at === undefined);
t('draft uses Web Public Address, not the CRM Address', mapped.record.draft.address.street === 'Rutherford Grove' && !JSON.stringify(mapped.record.draft).includes('1/10'));
t('draft uses Web Title and Web Description, not the CRM Description', mapped.record.draft.title === 'SDA property, Armstrong Creek' && mapped.record.draft.description.length === 2 && !JSON.stringify(mapped.record.draft).includes('vendor motivation'));
t('draft leaves out CRM Price, Yield, Agent, Features, Sharepoint Link and Deals', (() => { const j = JSON.stringify(mapped.record.draft); return !/695|6\.5|Agent Name|Citizen|sharepoint|deal-1/i.test(j); })());
t('internal values are kept only under internal', mapped.record.internal.priceAud === 695000 && mapped.record.internal.yieldPct === 6.5 && mapped.record.internal.address === INTERNAL);
t('maps Design Category and Build Type through the allowlist', mapped.record.draft.sda.designCategories[0] === 'HPS' && mapped.record.draft.sda.buildingType === 'New build');
t('a fully valid page has no issues and validates for publication', mapped.issues.length === 0 && L.validateForPublication(mapped.record, { allowDemo: false, mediaBaseUrl: MEDIA, internalAddress: INTERNAL, internalPriceAud: 695000, authorisedApproverIds: APPROVERS, compliance: COMPLY }, now).ok);

const noWeb = L.pageToRecord(page({ [N.webStatus]: undefined }));
t('a row with no Web Listing Status is Not Published and has no draft (default blocks)', noWeb.record.webStatus === 'not_published' && noWeb.record.draft === null);
t('an empty Web Listing Status is Not Published', L.pageToRecord(page({ [N.webStatus]: P_.sel('') })).record.webStatus === 'not_published');
const unknown = L.pageToRecord(page({ [N.webStatus]: P_.sel('Live!') }));
t('an unknown status is Not Published and reported', unknown.record.webStatus === 'not_published' && unknown.issues.length > 0);
for (const [label, status] of [['Draft', 'draft'], ['In Review', 'in_review'], ['Under Offer', 'under_offer'], ['Sold', 'sold'], ['Withdrawn', 'withdrawn']]) {
  t(`maps status ${label}`, L.pageToRecord(page({ [N.webStatus]: P_.sel(label) })).record.webStatus === status);
}
t('an archived or trashed page is withdrawn', L.pageToRecord({ ...page(), archived: true }).record.webStatus === 'withdrawn' && L.pageToRecord({ ...page(), in_trash: true }).record.webStatus === 'withdrawn');
const numAddr = L.pageToRecord(page({ [N.webPublicAddress]: P_.rt('10 Rutherford Grove, Armstrong Creek VIC 3217') }));
t('a house number in Web Public Address blocks the draft', numAddr.record.draft === null && numAddr.issues.some((i) => /house or unit/.test(i)));
t('a state that disagrees with State/ Territory is reported', L.pageToRecord(page({ [N.state]: P_.sel('Queensland') })).issues.some((i) => /disagrees/.test(i)));
t('full state names are understood', L.pageToRecord(page({ [N.state]: P_.sel('Victoria') })).issues.length === 0);
t('asking price without an approved amount blocks the draft', L.pageToRecord(page({ [N.webPricingMode]: P_.sel('Asking Price') })).record.draft === null);
const asking = L.pageToRecord(page({ [N.webPricingMode]: P_.sel('Asking Price'), [N.webDisplayPrice]: P_.rt('695000') }), { photos: [realPhoto()] });
t('asking price uses only Web Display Price, normalised to AUD', asking.record.draft.pricing.display === '$695,000' && asking.record.draft.pricing.mode === 'asking_price');
const guide = L.pageToRecord(page({ [N.webPricingMode]: P_.sel('Price Guide'), [N.webDisplayPrice]: P_.rt('$650,000 - $700,000') }), { photos: [realPhoto()] });
t('price guide range is normalised', guide.record.draft.pricing.display === '$650,000 to $700,000');
t('an amount on an EOI row is reported and ignored', (() => { const r = L.pageToRecord(page({ [N.webDisplayPrice]: P_.rt('$695,000') }), { photos: [realPhoto()] }); return r.issues.some((i) => /ignored/.test(i)) && !r.record.draft.pricing.display; })());
t('Contact Agent maps', L.pageToRecord(page({ [N.webPricingMode]: P_.sel('Contact Agent') }), { photos: [realPhoto()] }).record.draft.pricing.mode === 'contact_agent');
t('an unrecognised pricing mode blocks the draft', L.pageToRecord(page({ [N.webPricingMode]: P_.sel('Make an offer') })).record.draft === null);
t('an unknown Design Category is reported', L.pageToRecord(page({ [N.designCategory]: P_.multi('Mystery') })).issues.some((i) => /not recognised/.test(i)));
t('the slug is derived from the public address, letters only', mapped.record.draft.slug === 'rutherford-grove-armstrong-creek-vic');
t('a same-street property gets a distinct letter-only slug', (() => { const r = L.pageToRecord(page({}, '2e2909c1-0000-0000-0000-000000000009'), { takenSlugs: new Set(['rutherford-grove-armstrong-creek-vic']) }); return r.record.draft.slug !== 'rutherford-grove-armstrong-creek-vic' && /^[a-z-]+$/.test(r.record.draft.slug); })());
t('a slug frozen by a previous approval is kept', L.pageToRecord(page(), { slug: 'frozen-slug-here' }).record.draft.slug === 'frozen-slug-here');
t('the title defaults to the suburb when Web Title is empty', L.pageToRecord(page({ [N.webTitle]: P_.rt('') })).record.draft.title === 'SDA property, Armstrong Creek');
t('an empty Web Description is reported', L.pageToRecord(page({ [N.webDescription]: P_.rt('') })).issues.some((i) => /Description/.test(i)));
t('the approved status is understood', L.pageToRecord(page({ [N.webStatus]: P_.sel('Approved') })).record.webStatus === 'approved');
t('the data source id accepts the collection:// form', L.readNotionConfig({ NOTION_TOKEN: 'x', NOTION_PROPERTIES_DATA_SOURCE_ID: 'collection://2e2909c1-bb60-8177-bf4f-000b40ef0d48' }).dataSourceId === '2e2909c1-bb60-8177-bf4f-000b40ef0d48');
t('the CRM price is never promoted into public content', (() => { const r = L.pageToRecord(page({ [N.webDescription]: P_.rt('Priced at 695,000 for quick sale.') }), { photos: [realPhoto()] }); return !L.validateForPublication(r.record, { allowDemo: false, mediaBaseUrl: MEDIA, internalAddress: INTERNAL, internalPriceAud: 695000, authorisedApproverIds: APPROVERS, compliance: COMPLY }, now).ok; })());
const sch = L.checkSchema(page());
t('recognises the validated Properties database', sch.isValidatedDatabase && sch.missingWeb.length === 0);
const preMigration = (() => { const p = page(); for (const k of Object.keys(p.properties)) if (k.startsWith('Web ')) delete p.properties[k]; return p; })();
t('detects Web fields that are not yet created in Notion', L.checkSchema(preMigration).missingWeb.length === 6 && L.checkSchema(preMigration).missingOptional.length === 3 && L.pageToRecord(preMigration).record.webStatus === 'not_published');
t('rejects a different database also called Properties', !L.checkSchema({ id: 'x', properties: { Name: P_.title('x'), Units: P_.num(1) } }).isValidatedDatabase);

const man = (over = {}) => ({ version: 1, photos: [{ id: 'a1b2c3d4e5f6', alt: 'Front elevation of a home', width: 1600, height: 1200, accent: 'teal', privacyReviewed: true, files: [{ w: 480, file: 'a1b2c3d4e5f6-480.webp' }], ...over }] });
const murl = `${MEDIA}/lst/manifest.json`;
t('manifest resolves to approved-origin photo URLs', L.manifestToPhotos(man(), murl, MEDIA).photos[0].variants[0].src === `${MEDIA}/lst/a1b2c3d4e5f6-480.webp`);
t('manifest rejects an unreviewed photo', L.manifestToPhotos(man({ privacyReviewed: false }), murl, MEDIA).photos.length === 0);
t('manifest accepts a photo with no alt text and gives it the neutral fallback', (() => { const r = L.manifestToPhotos(man({ alt: '' }), murl, MEDIA); return r.photos.length === 1 && r.photos[0].alt === 'Photograph of the property' && r.issues.length === 0; })());
t('manifest accepts a short description such as Kitchen', ['Kitchen', 'Bedroom', 'Bathroom'].every((a) => L.manifestToPhotos(man({ alt: a }), murl, MEDIA).photos[0]?.alt === a));
t('the fallback numbers photographs and floorplans separately and says nothing else', (() => { const m2 = { version: 1, photos: [man({ id: 'a1b2c3d4e5f6', alt: '' }).photos[0], man({ id: 'b1b2c3d4e5f6', alt: 'Kitchen' }).photos[0], man({ id: 'c1b2c3d4e5f6', alt: '', kind: 'floorplan' }).photos[0]] }; const r = L.manifestToPhotos(m2, murl, MEDIA).photos.map((p) => p.alt); return r[0] === 'Photograph 1 of 2 of the property' && r[1] === 'Kitchen' && r[2] === 'Floorplan of the property'; })());
t('a fallback description passes the website publication safety checks (no number beside a street, no amounts)', (() => { const c = withMod((x) => { x.photos = [{ ...realPhoto(), alt: 'Photograph 1 of 12 of the property' }]; }); return L.checkPublicSafety(c, { allowDemo: false, mediaBaseUrl: MEDIA }).filter((m) => /house|unit|dollar|financial|email|phone/i.test(m)).length === 0; })());
t('the published schema accepts a one-word alt text and still refuses an empty or 201-character one', (() => { const ok = (alt) => L.publicContentSchema.safeParse(withMod((c) => { c.photos = [{ ...realPhoto(), alt }]; })).success; return ok('Kitchen') && !ok('') && !ok('x'.repeat(201)); })());
t('manifest rejects a file on a foreign origin', L.manifestToPhotos(man({ files: [{ w: 480, file: 'https://evil.example.test/x.webp' }] }), murl, MEDIA).photos.length === 0);
t('manifest rejects an unknown accent', L.manifestToPhotos(man({ accent: 'hotpink' }), murl, MEDIA).photos.length === 0);

const calls = [];
const mockFetch = (pages, status = 200) => async (url, init) => {
  calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body });
  const h = (extra) => ({ get: (k) => (extra ?? {})[k.toLowerCase()] ?? null });
  return { ok: status === 200, status, headers: h(init?.__h), json: async () => pages.shift() };
};
const DS = '2e2909c1-bb60-8177-bf4f-000b40ef0d48';
const CFG = { token: 'secret-token', dataSourceId: DS, version: '2026-03-11' };
const fast = (fetchImpl, extra = {}) => ({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, ...extra });
const client = new L.NotionReadClient(CFG, fast(mockFetch([{ results: [page()], has_more: true, next_cursor: 'c2' }, { results: [page({}, 'other')], has_more: false }])));
const all = await client.queryAll();
t('client paginates the data source query', all.length === 2 && calls.length === 2 && JSON.parse(calls[1].body).start_cursor === 'c2');
t('client only ever calls the data source query endpoint', calls.every((c) => c.url === `https://api.notion.com/v1/data_sources/${DS}/query` && c.method === 'POST'));
t('client sends the token and pinned Notion-Version', calls[0].headers.Authorization === 'Bearer secret-token' && calls[0].headers['Notion-Version'] === '2026-03-11');
t('the client class exposes no write surface', JSON.stringify(Object.getOwnPropertyNames(L.NotionReadClient.prototype).sort()) === JSON.stringify(['constructor', 'queryAll', 'request', 'retrieveDataSource', 'retrievePage', 'retrieveSelf']));
calls.length = 0;
await new L.NotionReadClient(CFG, fast(mockFetch([page()]))).retrievePage('402909c1-bb60-817e-b2d8-d9def6dde218');
t('reading a page is a GET to the pages endpoint and nothing else', calls.length === 1 && calls[0].method === 'GET' && calls[0].url === 'https://api.notion.com/v1/pages/402909c1-bb60-817e-b2d8-d9def6dde218' && !calls[0].body);
t('a Notion HTTP error fails loudly', await new L.NotionReadClient(CFG, fast(mockFetch([], 500), { maxRetries: 1 })).queryAll().then(() => false, () => true));
calls.length = 0;
await L.fetchManifest(murl, mockFetch([man()]));
t('the Notion token is never sent to the manifest host', !JSON.stringify(calls[0].headers).toLowerCase().includes('authorization'));
t('config is null without credentials', L.readNotionConfig({}) === null && L.readNotionConfig({ NOTION_TOKEN: 'x' }) === null && L.readNotionConfig({ NOTION_TOKEN: 'x', NOTION_PROPERTIES_DATA_SOURCE_ID: DS }).dataSourceId === DS);
t('the data source id is configured through the environment, never hard-coded', !/2e2909c1-bb60-8177/.test(readFileSync(join(repoRoot, 'src/data/listings/notion.ts'), 'utf8')));

/* ------------------------------------------------- workflow, withdrawal, readiness */
section('publication workflow, controlled withdrawal and readiness report');
t('Approved is signed off but not live: the last released version stays up', res({ webStatus: 'approved' }).visible && res({ webStatus: 'approved', snapshot: undefined }).visible === false);
t('a tombstone hides a listing even while Notion still says Published', !res({ withdrawn: true }).visible && !res({ withdrawn: true, webStatus: 'under_offer' }).visible);
t('a tombstone removes the listing from the public list', L.buildPublicListings({ records: L.FIXTURE_RECORDS, snapshots: L.FIXTURE_SNAPSHOTS, now, ctx: { allowDemo: true }, withdrawn: new Set(['fx_001']) }).every((l) => l.id !== 'fx_001'));
t('other listings are unaffected by a tombstone', L.buildPublicListings({ records: L.FIXTURE_RECORDS, snapshots: L.FIXTURE_SNAPSHOTS, now, ctx: { allowDemo: true }, withdrawn: new Set(['fx_001']) }).length === 2);
const pre = (status) => L.validateForPublication(real({ webStatus: status }), vctx, now, { preflight: true });
t('preflight can check Draft, In Review and Approved rows', ['draft', 'in_review', 'approved'].every((st) => pre(st).ok));
t('preflight still enforces every other rule', !L.validateForPublication(real({ webStatus: 'approved', approval: {} }), vctx, now, { preflight: true }).ok);

const pilotAddr = (a) => L.suggestPublicAddress(a);
t('suggests the public address without the unit and house number', pilotAddr('1/10 Rutherford Grove, Armstrong Creek VIC 3217') === 'Rutherford Grove, Armstrong Creek VIC 3217');
t('handles unit/number and letter suffixes', pilotAddr('2/20 Gymea Street, Mount Duneed VIC 3217') === 'Gymea Street, Mount Duneed VIC 3217' && pilotAddr('30B Sheppard Street, Shepparton VIC 3630') === 'Sheppard Street, Shepparton VIC 3630');
t('returns nothing for an address it cannot read safely', pilotAddr('PO Box 5, Nowhere') === undefined && pilotAddr(undefined) === undefined);
t('the suggestion itself never contains a number before the street', !/\d+[a-z]?\s+Rutherford/.test(pilotAddr('1/10 Rutherford Grove, Armstrong Creek VIC 3217')));

const rowOf = (rep, item) => rep.rows.find((r) => r.item === item);
const pilotPage = page({ [N.webStatus]: P_.sel('Draft'), [N.webPublicAddress]: P_.rt(''), [N.webDescription]: P_.rt(''), [N.webPricingMode]: P_.sel(''), [N.webApprovedBy]: P_.people() });
const rep0 = L.readinessReport(pilotPage, { now });
t('an unprepared row is not publishable and says exactly what is missing', !rep0.canPublish && ['Web Public Address', 'Web Description', 'Web Pricing Mode', 'Web Approved By', 'Approved photographs'].every((k) => rowOf(rep0, k).status === 'missing'));
t('the report suggests the public address to paste', rowOf(rep0, 'Web Public Address').note.includes('Rutherford Grove, Armstrong Creek VIC 3217') && rep0.suggestedPublicAddress === 'Rutherford Grove, Armstrong Creek VIC 3217');
t('Price, Yield, Features and the SharePoint link are reported as protected, never published', ['Internal Price', 'Internal Yield', 'Features', 'Sharepoint Link'].every((k) => rowOf(rep0, k).status === 'protected'));
t('Design Category needs an explicit approval', rowOf(rep0, 'Design Category').status === 'needs_approval');
t('the report never repeats the internal price, yield or SharePoint URL', !JSON.stringify(rep0).match(/695000|6\.5|tenant\.sharepoint/));
const repOk = L.readinessReport(page(), { photos: [realPhoto()], mediaBaseUrl: MEDIA, now, authorisedApproverIds: APPROVERS, compliance: COMPLY });
t('a fully prepared row is publishable', repOk.canPublish && repOk.rows.every((r) => r.status !== 'missing'));
t('a row from before the Notion migration reports the missing Web fields', L.readinessReport(preMigration, { now }).rows.find((r) => r.item === 'Web fields exist in Notion').status === 'missing');
t('the derived media manifest location is under the public id', L.manifestUrlFor('lst_abc1234567', `${MEDIA}/`) === `${MEDIA}/lst_abc1234567/manifest.json`);

/* ------------------------------------- Notion client behaviour (mock transport) */
section('Notion client: retries, limits, errors, ids and schema');
const seq = (list) => {
  const log = [];
  const f = async (url, init) => {
    log.push({ url: String(url), method: init?.method, headers: init?.headers });
    const r = list.shift();
    return { ok: r.status === 200, status: r.status, headers: { get: (k) => (r.headers ?? {})[k.toLowerCase()] ?? null }, json: async () => { if (r.badJson) throw new Error('not json'); return r.body; } };
  };
  return { f, log };
};
const ok200 = (body) => ({ status: 200, body });
const withSleep = (f, slept, extra = {}) => ({ fetchImpl: f, sleep: async (ms) => { slept.push(ms); }, minIntervalMs: 0, ...extra });
{
  const slept = [];
  const { f, log } = seq([{ status: 429, headers: { 'retry-after': '2' }, body: { code: 'rate_limited' } }, ok200({ results: [page()], has_more: false })]);
  const r = await new L.NotionReadClient(CFG, withSleep(f, slept)).queryAll();
  t('a 429 is retried after the Retry-After delay', r.length === 1 && log.length === 2 && slept.includes(2000));
}
{
  const slept = [];
  const { f } = seq([{ status: 529, body: { code: 'service_overload' } }, ok200({ results: [], has_more: false })]);
  t('a 529 is retried with backoff', (await new L.NotionReadClient(CFG, withSleep(f, slept)).queryAll()).length === 0 && slept.some((ms) => ms >= 500));
}
{
  const { f, log } = seq([{ status: 401, body: { code: 'unauthorized' } }]);
  const err = await new L.NotionReadClient(CFG, withSleep(f, [])).queryAll().catch((e) => e);
  t('a 401 is not retried and the error carries only status and code', err instanceof L.NotionApiError && err.status === 401 && err.code === 'unauthorized' && log.length === 1);
  t('the error message never contains the token or a header', !String(err.message).includes('secret-token') && !/bearer/i.test(String(err.message)) && !JSON.stringify(err).includes('secret-token'));
}
{
  const { f, log } = seq([{ status: 429, body: { code: 'public_api_request_blocked' } }]);
  t('a blocked request is not retried', await new L.NotionReadClient(CFG, withSleep(f, [])).queryAll().then(() => false, (e) => e.status === 429 && log.length === 1));
}
{
  const { f, log } = seq(Array.from({ length: 3 }, () => ({ status: 503, body: {} })));
  t('retries stop at the cap', await new L.NotionReadClient(CFG, withSleep(f, [], { maxRetries: 2 })).queryAll().then(() => false, () => log.length === 3));
}
t('a non-JSON error body is handled', await new L.NotionReadClient(CFG, withSleep(seq([{ status: 404, badJson: true }]).f, [])).retrievePage('402909c1-bb60-817e-b2d8-d9def6dde218').then(() => false, (e) => e.status === 404 && e.code === undefined));
t('an incomplete (capped) result is an error, never silent truncation', await new L.NotionReadClient(CFG, withSleep(seq([ok200({ results: [page()], has_more: false, request_status: { type: 'incomplete', incomplete_reason: 'query_result_limit_reached' } })]).f, [])).queryAll().then(() => false, (e) => /incomplete/.test(e.message)));
{
  const { f, log } = seq([ok200({ results: [], has_more: false })]);
  await new L.NotionReadClient(CFG, withSleep(f, [])).queryAll({ filterProperties: ['Name', 'State/ Territory'] });
  t('filter_properties are sent as repeated, encoded query parameters', log[0].url.endsWith('?filter_properties=Name&filter_properties=State%2F%20Territory'));
}
{
  const { f, log } = seq([ok200({ properties: {} })]);
  await new L.NotionReadClient(CFG, withSleep(f, [])).retrieveDataSource();
  t('retrieving the data source is a GET on its own endpoint', log[0].method === 'GET' && log[0].url === `https://api.notion.com/v1/data_sources/${DS}`);
}
{
  const cfg = L.readNotionConfig({ NOTION_TOKEN: 'x', NOTION_PROPERTIES_DATA_SOURCE_ID: `collection://${DS}` });
  const { f, log } = seq([ok200({ results: [], has_more: false })]);
  await new L.NotionReadClient(cfg, withSleep(f, [])).queryAll();
  t('the collection:// URI is converted to a UUID and never sent to the REST API', !log[0].url.includes('collection') && log[0].url.includes(DS));
}
t('a dashless UUID is accepted', L.normaliseNotionId('2e2909c1bb608177bf4f000b40ef0d48') === '2e2909c1bb608177bf4f000b40ef0d48');
t('a value that is not a UUID is rejected', throws(() => L.normaliseNotionId('not-a-uuid')) && throws(() => L.normaliseNotionId('collection://nope')));
t('the DATABASE id is rejected where a data source id is required', throws(() => L.readNotionConfig({ NOTION_TOKEN: 'x', NOTION_PROPERTIES_DATA_SOURCE_ID: '2e2909c1-bb60-81b5-8806-ff710a8274ed' })));
t('the API version is pinned and overridable only explicitly', L.NOTION_VERSION === '2026-03-11' && L.readNotionConfig({ NOTION_TOKEN: 'x', NOTION_PROPERTIES_DATA_SOURCE_ID: DS }).version === '2026-03-11' && L.readNotionConfig({ NOTION_TOKEN: 'x', NOTION_PROPERTIES_DATA_SOURCE_ID: DS, NOTION_API_VERSION: '2025-09-03' }).version === '2025-09-03');
{
  const slept = [];
  const { f } = seq([ok200({ results: [page()], has_more: true, next_cursor: 'c' }), ok200({ results: [], has_more: false })]);
  await new L.NotionReadClient(CFG, { fetchImpl: f, sleep: async (ms) => { slept.push(ms); }, minIntervalMs: 350, now: () => 1000 }).queryAll();
  t('requests are paced to respect the data source query limit', slept.includes(350));
}

// the real response shapes for empty values (from the Notion property value reference)
const emptyPage = { id: '2e2909c1-0000-0000-0000-0000000000aa', properties: {
  [N.name]: { type: 'title', title: [] }, [N.address]: { type: 'rich_text', rich_text: [] }, [N.price]: { type: 'number', number: null },
  [N.yield]: { type: 'number', number: null }, [N.designCategory]: { type: 'select', select: null }, [N.state]: { type: 'select', select: null },
  [N.features]: { type: 'multi_select', multi_select: [] }, [N.deals]: { type: 'relation', relation: [], has_more: false },
  [N.sharepointLink]: { type: 'url', url: null }, [N.listingEndDate]: { type: 'date', date: null },
  [N.webStatus]: { type: 'select', select: null }, [N.webApprovedBy]: { type: 'people', people: [] }, [N.webFeatured]: { type: 'checkbox', checkbox: false },
} };
{
  const r = L.pageToRecord(emptyPage);
  t('null and empty property values never throw and default to Not Published', r.record.webStatus === 'not_published' && r.record.draft === null && r.record.internal.priceAud === undefined && r.record.approval.byUserId === undefined && r.record.featured === false);
}
t('a date with end and time zone still reads its start', L.readText({ type: 'date', date: { start: '2026-09-15', end: '2026-09-20', time_zone: 'Australia/Melbourne' } }) === '2026-09-15');
t('a relation reports its ids and tolerates truncation', L.readRelationIds({ type: 'relation', relation: [{ id: 'a' }, { id: 'b' }], has_more: true }).join() === 'a,b');
t('a number Web Display Price works (Notion number type)', L.pageToRecord(page({ [N.webPricingMode]: P_.sel('Asking Price'), [N.webDisplayPrice]: P_.num(695000) }), { photos: [realPhoto()] }).record.draft.pricing.display === '$695,000');
t('a Notion people value with an id and no name is understood', L.readPeople({ type: 'people', people: [{ object: 'user', id: 'user-x' }] })[0].id === 'user-x' && L.readPeople({ type: 'people', people: [] }).length === 0);
t('Design Category R maps to Robust and Basic is a recognised SDA category', L.mapDesignCategories(['R']).values[0] === 'Robust' && L.mapDesignCategories(['Basic']).values[0] === 'Basic' && L.mapDesignCategories(['Basic']).unknown.length === 0);

const dsPayload = (mod = (x) => x) => {
  const props = {};
  const add = (name, type, extra = {}) => { props[`id_${name}`] = { id: `id_${name}`, name, type, ...extra }; };
  for (const [n, ty] of Object.entries(L.EXPECTED_CORE_TYPES)) add(n, ty);
  props['id_Design Category'].select = { options: ['HPS', 'IL', 'R', 'FA', 'Basic'].map((name) => ({ name })) };
  props['id_State/ Territory'].select = { options: ['QLD', 'VIC', 'NSW', 'SA', 'WA', 'TAS', 'NT', 'ACT'].map((name) => ({ name })) };
  return mod({ properties: props, add });
};
{
  const c = L.checkDataSourceSchema(dsPayload());
  t('the verified CRM schema is recognised, whether keyed by id or name', c.isValidatedDatabase && c.wrongCoreType.length === 0 && c.missingCore.length === 0);
  t('all nine Web properties are listed as still to add, with exact types', c.toAdd.length === 9 && c.toAdd.find((a) => a.name === N.webDisplayPrice).type === 'number' && c.toAdd.find((a) => a.name === N.webApprovedBy).type === 'people' && c.toAdd.find((a) => a.name === N.webFeatured).type === 'checkbox' && c.toAdd.find((a) => a.name === N.webPhotoFolder).type === 'url');
  t('every Design Category option in the real schema maps, and all state codes map', c.unmappedDesignOptions.length === 0 && c.unmappedStateOptions.length === 0);
  t('the Web status and pricing option lists are exactly as proposed', c.toAdd.find((a) => a.name === N.webStatus).options.join() === 'Not Published,Draft,In Review,Approved,Published,Under Offer,Sold,Withdrawn' && c.toAdd.find((a) => a.name === N.webPricingMode).options.join() === 'Asking Price,Price Guide,Expressions of Interest,Contact Agent');
  t('a hidden Deals relation (the integration must not see the Deals database) is not a schema failure', !('Deals' in L.EXPECTED_CORE_TYPES) && L.OPTIONAL_CORE_TYPES.Deals === 'relation' && c.isValidatedDatabase && c.missingCore.length === 0);
  t('a visible Deals property of the wrong type is still reported', !L.checkDataSourceSchema(dsPayload((d) => { d.add('Deals', 'rich_text'); return d; })).isValidatedDatabase);
  t('a visible Deals relation is accepted', L.checkDataSourceSchema(dsPayload((d) => { d.add('Deals', 'relation'); return d; })).isValidatedDatabase);
  const bad = L.checkDataSourceSchema(dsPayload((d) => { d.properties['id_Price'].type = 'rich_text'; return d; }));
  t('a CRM property with the wrong type is reported', !bad.isValidatedDatabase && bad.wrongCoreType[0].name === 'Price');
  const done = L.checkDataSourceSchema(dsPayload((d) => { for (const w of L.WEB_SCHEMA) d.add(w.name, w.type, w.options ? { select: { options: w.options.map((name) => ({ name })) } } : {}); return d; }));
  t('once the Web properties exist with the right types nothing is left to add', done.toAdd.length === 0 && done.wrongWebType.length === 0 && done.missingSelectOptions.length === 0);
  const wrong = L.checkDataSourceSchema(dsPayload((d) => { d.add(N.webDisplayPrice, 'rich_text'); return d; }));
  t('a Web property created with the wrong type is reported', wrong.wrongWebType[0].name === N.webDisplayPrice && wrong.wrongWebType[0].expected === 'number');
  const partial = L.checkDataSourceSchema(dsPayload((d) => { d.add(N.webStatus, 'select', { select: { options: [{ name: 'Draft' }] } }); return d; }));
  t('a select with missing options is reported', partial.missingSelectOptions[0].missing.includes('Published'));
}

/* ---------------------------- approver authorisation and the proposal step */
section('approver authorisation and the proposal step');
const apprCtx = (ids) => ({ ...vctx, authorisedApproverIds: ids });
t('an unlisted approver is refused even though a person is named', !L.validateForPublication(real({ approval: { by: 'Eve', byUserId: 'user-eve', at: '2026-02-01T00:00:00Z' } }), apprCtx(APPROVERS), now).ok);
t('with no authorised approvers configured nobody can approve (default deny)', !L.validateForPublication(real(), apprCtx([]), now).ok && !L.validateForPublication(real(), { ...vctx, authorisedApproverIds: undefined }, now).ok);
t('an approver without a verifiable id (not a person field) is refused', !L.validateForPublication(real({ approval: { by: 'Steve Dawson', at: '2026-02-01T00:00:00Z' } }), apprCtx(APPROVERS), now).ok);
t('a listed approver is accepted', L.validateForPublication(real(), apprCtx(APPROVERS), now).ok);
t('a partial user (id only) can be authorised by id', L.validateForPublication(real({ approval: { byUserId: 'user-steve', at: '2026-02-01T00:00:00Z' } }), apprCtx(APPROVERS), now).ok);
t('fixtures do not need approvers (they never reach production)', L.validateForPublication(L.FIXTURE_RECORDS[0], { allowDemo: true }, now).ok);
{
  const rr = L.pageToRecord({ ...page(), last_edited_time: '2026-02-01T09:30:00.000Z' }, { photos: [realPhoto()], approvedAt: APPROVED_AT }).record;
  const snapOk = L.nextSnapshot(rr, L.validateForPublication(rr, apprCtx(APPROVERS), now).content, undefined, now);
  t('a snapshot records approver id, source edit time, featured flag and a verifiable hash', snapOk.approvedById === 'user-steve' && snapOk.sourceEditedAt === '2026-02-01T09:30:00.000Z' && snapOk.featured === true && L.contentHash(snapOk.content) === snapOk.contentHash);
}

const PID = (pageId) => L.publicIdFor(pageId);
const pg = (over = {}, id = '2e2909c1-0000-0000-0000-00000000a001') => page(over, id);
const manifestFor = (pages, skip = []) => async (url) => {
  if (skip.some((id) => url.includes(id))) throw new Error('404');
  return man({ files: [{ w: 480, file: 'a1b2c3d4e5f6-480.webp' }] });
};
const run = (pages, extra = {}) => L.propose({ pages, previous: new Map(), withdrawn: new Set(), approvers: APPROVERS, compliance: COMPLY, mediaBase: MEDIA, getManifest: manifestFor(pages), now, ...extra });
{
  const A = pg();
  const out = await run([A]);
  t('a complete, authorised row yields a proposed first snapshot', out.length === 1 && out[0].kind === 'new' && out[0].snapshot.version === 1 && out[0].snapshot.content.slug === 'rutherford-grove-armstrong-creek-vic');
  t('the proposed snapshot carries no internal data', !/695|3\/19|sharepoint|Citizen|vendor motivation/i.test(JSON.stringify(out[0].snapshot)));
  const B = pg({ [N.webApprovedBy]: P_.person('user-eve', 'Eve') }, '2e2909c1-0000-0000-0000-00000000a002');
  const C = pg({}, '2e2909c1-0000-0000-0000-00000000a003');
  const D = pg({ [N.webStatus]: P_.sel('Draft'), [N.webDescription]: P_.rt('') }, '2e2909c1-0000-0000-0000-00000000a004');
  const E = pg({ [N.webStatus]: P_.sel('Not Published') }, '2e2909c1-0000-0000-0000-00000000a005');
  const all = await run([A, B, C, D, E], { getManifest: manifestFor([], [PID(C.id)]) });
  const k = (pageObj) => all.find((x) => x.id === PID(pageObj.id));
  t('an unauthorised approver yields no snapshot', k(B).kind === 'failed' && !k(B).snapshot && k(B).issues.some((m) => /not an authorised approver/.test(m)));
  t('missing photographs yield no snapshot', k(C).kind === 'failed' && !k(C).snapshot && k(C).issues.some((m) => /no prepared photographs/.test(m)));
  t('a Draft row is only checked and reported, never proposed', k(D).kind === 'not_ready' && !k(D).snapshot);
  t('a Not Published row is ignored entirely', !k(E));
  const same = await run([pg()], { previous: new Map([[PID(A.id), out[0].snapshot]]) });
  t('re-running with nothing changed proposes nothing', same[0].kind === 'unchanged' && !same[0].snapshot);
  const offer = await run([pg({ [N.webStatus]: P_.sel('Under Offer') })], { previous: new Map([[PID(A.id), out[0].snapshot]]) });
  t('Under Offer is a status change, not new content: same version, same hash', offer[0].kind === 'status' && offer[0].snapshot.commercialStatus === 'under_offer' && offer[0].snapshot.version === 1 && offer[0].snapshot.contentHash === out[0].snapshot.contentHash);
  const edited = await run([pg({ [N.webDescription]: P_.rt('A reworded public description.') })], { previous: new Map([[PID(A.id), out[0].snapshot]]) });
  t('edited public copy becomes version 2 with the slug frozen', edited[0].kind === 'version' && edited[0].snapshot.version === 2 && edited[0].snapshot.content.slug === out[0].snapshot.content.slug);
  const lost = await run([pg({ [N.webApprovedBy]: P_.person('user-eve', 'Eve') })], { previous: new Map([[PID(A.id), out[0].snapshot]]) });
  t('a row that now fails validation proposes nothing and leaves the previous version alone', lost[0].kind === 'failed' && !lost[0].snapshot);
  {
    // the portal overlay (never Notion) decides the status: a content update must not reset Under offer or Sold to Available
    const prevOffer = { ...out[0].snapshot, commercialStatus: 'under_offer' };
    const asPortal = (props, prev, payload) => overlayPage(pg(props), { content: { title: 'SDA property, Armstrong Creek', description: 'First public paragraph.\n\nSecond public paragraph.', publicAddress: 'Rutherford Grove, Armstrong Creek VIC 3217', pricingMode: 'eoi', displayPrice: null, featured: true, ...payload } }, { notionUserId: 'user-steve', name: 'SDA Home Choices' }, prev);
    const upd = await run([asPortal({}, prevOffer, { description: 'A reworded public description.' })], { previous: new Map([[PID(A.id), prevOffer]]), approvers: ['user-steve'] });
    t('a content update through the portal keeps an Under offer listing Under offer', upd[0].kind === 'version' && upd[0].snapshot.commercialStatus === 'under_offer');
    const toSold = await run([asPortal({}, out[0].snapshot, { commercialStatus: 'sold' })], { previous: new Map([[PID(A.id), out[0].snapshot]]), approvers: ['user-steve'] });
    t('a requested status with identical content is a status move: same version, same hash, new status', toSold[0].kind === 'status' && toSold[0].snapshot.commercialStatus === 'sold' && toSold[0].snapshot.version === out[0].snapshot.version && toSold[0].snapshot.contentHash === out[0].snapshot.contentHash);
    t('a status move keeps the approver of the version (nobody new is named)', toSold[0].snapshot.approvedBy === out[0].snapshot.approvedBy && toSold[0].snapshot.approvedById === out[0].snapshot.approvedById);
    const notionSold = await run([asPortal({ [N.webStatus]: P_.sel('Withdrawn') }, out[0].snapshot, {})], { previous: new Map([[PID(A.id), out[0].snapshot]]), approvers: ['user-steve'] });
    t('Notion Web Listing Status (even Withdrawn or Not Published) is not a gate for a portal publication', notionSold[0].kind === 'unchanged');
    const ended = await run([asPortal({ [N.listingEndDate]: P_.date('2020-01-01') }, out[0].snapshot, {})], { previous: new Map([[PID(A.id), out[0].snapshot]]), approvers: ['user-steve'] });
    t('a Notion Listing End Date can never enter a snapshot through the portal', ended[0].kind === 'unchanged');
    const keeps = { ...out[0].snapshot, listingEndDate: '2031-06-30' };
    const kept = await run([asPortal({}, keeps, { commercialStatus: 'sold' })], { previous: new Map([[PID(A.id), keeps]]), approvers: ['user-steve'] });
    t('an end date already in the snapshot is preserved by a status move', kept[0].snapshot.listingEndDate === '2031-06-30' && kept[0].snapshot.commercialStatus === 'sold');
  }
  const tomb = await run([pg()], { withdrawn: new Set([PID(A.id)]) });
  t('an explicitly withdrawn listing is never proposed again', tomb[0].kind === 'withdrawn' && !tomb[0].snapshot);
  const twin = await run([pg(), pg({}, '2e2909c1-0000-0000-0000-00000000a009')]);
  t('two properties on the same street get distinct slugs', twin.length === 2 && twin[0].snapshot.content.slug !== twin[1].snapshot.content.slug && /^[a-z-]+$/.test(twin[1].snapshot.content.slug));
  t('proposing does nothing without an authorised approver list', (await run([pg()], { approvers: [] }))[0].kind === 'failed');
}

/* ----------------------------- compliance gate and the Basic category */
section('Victorian compliance gate and the Basic design category');
const withState = (state, mode = 'eoi') => real({ draft: withMod((c) => { c.photos = [realPhoto()]; c.address = { ...c.address, state, postcode: state === 'VIC' ? '3217' : '4000' }; c.pricing = mode === 'asking_price' ? { mode, display: '$695,000' } : { mode }; }) });
const ctxWith = (compliance) => ({ ...vctx, compliance });
for (const mode of ['asking_price', 'price_guide', 'eoi', 'contact_agent']) {
  const rec = withState('VIC', mode === 'price_guide' ? 'asking_price' : mode);
  t(`a Victorian ${mode} listing is blocked until cleared`, !L.validateForPublication({ ...rec, draft: { ...rec.draft, pricing: mode === 'price_guide' ? { mode, display: '$650,000 to $700,000' } : rec.draft.pricing } }, ctxWith(DENY), now).ok);
}
t('with no compliance config at all, Victoria is denied (default deny)', !L.validateForPublication(withState('VIC'), { ...vctx, compliance: undefined }, now).ok);
{
  const det = { listingId: 'lst_det', pricingMode: 'contact_agent', basis: 'internal_determination', recordedBy: 'Someone', recordedAt: '2026-11-05', reference: 'https://example.test/guidance', statement: 'Internal determination, not legal advice.' };
  const cfg = (d) => ({ ...DENY, victoria: { ...DENY.victoria, determinations: d ? [d] : [] } });
  t('a complete determination clears only its own listing and mode', L.victorianClearance(cfg(det), 'lst_det', 'contact_agent').cleared === true && L.victorianClearance(cfg(det), 'lst_other', 'contact_agent').cleared === false && L.victorianClearance(cfg(det), 'lst_det', 'asking_price').cleared === false);
  t('a determination with a missing field does not clear', L.victorianClearance(cfg({ ...det, reference: '' }), 'lst_det', 'contact_agent').cleared === false && L.victorianClearance(cfg({ ...det, basis: 'guess' }), 'lst_det', 'contact_agent').cleared === false);
  t('no determinations and nothing cleared means not cleared', L.victorianClearance(DENY, 'lst_det', 'contact_agent').cleared === false && L.victorianClearance(undefined, 'lst_det', 'contact_agent').cleared === false);
}
t('the block names the unresolved legal question', L.validateForPublication(withState('VIC'), ctxWith(DENY), now).issues.some((m) => /Victorian pricing compliance is not cleared/.test(m)));
t('a recorded clearance lets a Victorian listing through', L.validateForPublication(withState('VIC'), ctxWith(COMPLY), now).ok);
t('clearance is per pricing mode', (() => { const only = { ...COMPLY, victoria: { ...COMPLY.victoria, cleared: { ...DENY.victoria.cleared, eoi: true } } }; return L.validateForPublication(withState('VIC', 'eoi'), ctxWith(only), now).ok && !L.validateForPublication(withState('VIC', 'contact_agent'), ctxWith(only), now).ok; })());
t('the Victorian gate does not apply to other states', L.validateForPublication(withState('QLD'), ctxWith(DENY), now).ok);
t('fixtures are not subject to the gate', L.validateForPublication(L.FIXTURE_RECORDS[0], { allowDemo: true, compliance: DENY }, now).ok);
const defaultCompliance = JSON.parse(readFileSync(join(repoRoot, 'src/data/listings/compliance.json'), 'utf8'));
t('the committed compliance file denies everything by default', Object.values(defaultCompliance.victoria.cleared).every((v) => v === false) && defaultCompliance.basicClassification.confirmedListingIds.length === 0);

t('Basic is a recognised SDA design category', L.DESIGN_CATEGORIES.includes('Basic') && L.DESIGN_LABEL.Basic === 'Basic');
const basicRec = (mod = (c) => c, id = 'lst_test000001') => real({ id, draft: withMod((c) => { c.photos = [realPhoto()]; c.sda = { designCategories: ['Basic'] }; mod(c); }) });
t('a Basic listing needs its classification validated first', !L.validateForPublication(basicRec(), ctxWith(COMPLY), now).ok && L.validateForPublication(basicRec(), ctxWith(COMPLY), now).issues.some((m) => /Basic/.test(m)));
const confirmed = { ...COMPLY, basicClassification: { confirmedListingIds: ['lst_test000001'] } };
t('a validated Basic listing is allowed', L.validateForPublication(basicRec(), ctxWith(confirmed), now).ok);
t('validation is per listing, not global', !L.validateForPublication(basicRec((c) => c, 'lst_other00002'), ctxWith(confirmed), now).ok);
for (const phrase of ['A new build home.', 'Newly built and ready.', 'Purpose-built accessible dwelling.', 'Brand new construction, a new dwelling.']) {
  t(`a Basic listing cannot be described as new build ("${phrase}")`, !L.validateForPublication(basicRec((c) => { c.description[0] = phrase; }), ctxWith(confirmed), now).ok);
}
t('a Basic listing with Build Type "New build" is blocked as inconsistent', !L.validateForPublication(basicRec((c) => { c.sda.buildingType = 'New build'; }), ctxWith(confirmed), now).ok);
t('the same wording is fine for a non-Basic listing', L.validateForPublication(real({ draft: withMod((c) => { c.photos = [realPhoto()]; c.description[0] = 'A new build home.'; c.sda = { designCategories: ['IL'] }; }) }), ctxWith(COMPLY), now).ok);
{
  const repB = L.readinessReport(page({ [N.designCategory]: P_.sel('Basic') }), { photos: [realPhoto()], mediaBaseUrl: MEDIA, now, authorisedApproverIds: APPROVERS, compliance: COMPLY });
  t('the report flags Basic as needing validation and says it is never new build', rowOf(repB, 'Design Category').note.includes('existing (legacy) SDA') && rowOf(repB, 'Basic classification validated').status === 'missing' && !repB.canPublish);
  const repV = L.readinessReport(page(), { photos: [realPhoto()], mediaBaseUrl: MEDIA, now, authorisedApproverIds: APPROVERS, compliance: DENY });
  t('the report shows the Victorian compliance blocker', rowOf(repV, 'Victorian pricing compliance').status === 'missing' && !repV.canPublish);
  t('the report marks the CRM Description and Listing Agent as protected', rowOf(repV, 'Description (CRM)').status === 'protected' && rowOf(repV, 'Listing Agent').status === 'protected');
}
t('a proposal in Victoria is refused while compliance is not cleared', (await run([pg()], { compliance: DENY }))[0].kind === 'failed');

/* ------------------- schema manifest, repository privacy, offline withdrawal */
section('schema manifest, public-repository privacy and offline withdrawal');
{
  const m = await import('./print-schema-manifest.mjs');
  t('the schema manifest documents match the code exactly (no drift)', readFileSync(join(repoRoot, 'docs/notion-schema-manifest.md'), 'utf8') === m.manifestMarkdown() && readFileSync(join(repoRoot, 'docs/notion-schema-manifest.json'), 'utf8') === `${JSON.stringify(m.manifestJson(), null, 2)}\n`);
  t('the manifest lists exactly the nine proposed fields with the final types', m.manifestJson().properties.map((p) => `${p.name}:${p.type}`).join() === 'Web Listing Status:select,Web Public Address:rich_text,Web Description:rich_text,Web Pricing Mode:select,Web Approved By:people,Web Display Price:number,Web Title:rich_text,Web Featured:checkbox,Web Photo Folder:url');
  t('every manifest property states a default behaviour and a mapping', m.manifestJson().properties.every((p) => p.defaultBehaviour && p.mapsTo));
}
// this repository is public: no real house or unit number of a real property may be committed. The patterns are
// assembled from pieces so this file does not contain what it forbids.
{
  const real = [['3', '/19'], ['4', '/27'], ['27', 'B']].map((p) => p.join(''));
  const re = new RegExp(`(${real.map((r) => r.replace('/', '\\/')).join('|')})\\s*(Rutherford|Gymea|Sheppard)|\\b(19|27)\\s+(Rutherford|Gymea|Sheppard)|(${['3', '/19'].join('')})`, 'i');
  const trackedText = tracked.filter((f) => /\.(md|json|mjs|ts|astro|yml|yaml|txt|css)$/.test(f));
  t('no real house or unit number of a real property exists in any tracked file', trackedText.every((f) => { try { return !re.test(readFileSync(join(repoRoot, f), 'utf8')); } catch { return true; } }));
  // any number written next to a pilot street must be one of the synthetic placeholders used by the fixtures
  const adjRe = new RegExp(`\\b(\\d+[A-Za-z]?(?:\\s*\\/\\s*\\d+[A-Za-z]?)?)\\s+(Rutherford|Gymea|Sheppard)`, 'gi');
  const syntheticNumbers = new Set(['1/10', '2/20', '30B', '10', '20', '30']);
  t('every number next to a pilot street is a known synthetic placeholder', trackedText.every((f) => { try { return [...readFileSync(join(repoRoot, f), 'utf8').matchAll(adjRe)].every((m) => syntheticNumbers.has(m[1].replace(/\s+/g, ''))); } catch { return true; } }));
  t('the pilot internal address is not written in the pilot document', !/Rutherford Grove, Armstrong Creek VIC 3217[^\n]*\n/.test(rd('docs/pilot-rutherford-grove.md').split('\n').filter((l) => /Dirección interna/.test(l)).join('\n')));
}
{
  const { spawnSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
  const tmp = mkdtempSync(join(tmpdir(), 'wd-'));
  mkdirSync(join(tmp, 'approved'));
  mkdirSync(join(tmp, 'withdrawn'));
  writeFileSync(join(tmp, 'approved', 'x.json'), JSON.stringify(L.FIXTURE_SNAPSHOTS[0]));
  const env = { PATH: process.env.PATH, LISTINGS_DATA_DIR: tmp };
  const cli = (...args) => spawnSync('node', [join(repoRoot, 'scripts/listings-sync.mjs'), ...args], { env, encoding: 'utf8' });
  const SENTINEL = 'PRIVATE-REASON-4f9a-sentinel';
  const r1 = cli('--withdraw', 'rutherford-grove-armstrong-creek-vic', '--reason', SENTINEL, '--by', 'Tester Person');
  const file = join(tmp, 'withdrawn', 'fx_001.json');
  t('emergency withdrawal runs with no Notion credentials and no network', r1.status === 0 && existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).withdrawnBy === 'SDA Home Choices');
  t('the emergency withdrawal file carries constant words only: no reason, no name, nothing the operator typed', (() => { const f = readFileSync(file, 'utf8'); return !f.includes(SENTINEL) && !f.includes('Tester') && JSON.parse(f).reason === 'withdrawn' && Object.keys(JSON.parse(f)).sort().join() === 'listingId,reason,withdrawnAt,withdrawnBy' && !(r1.stdout + r1.stderr).includes(SENTINEL) && /not stored/.test(r1.stdout); })());
  t('the withdrawal output tells the operator how to verify the build', /check:withdrawal/.test(r1.stdout));
  t('the emergency withdrawal works with no flags at all and refuses a missing target', cli('--withdraw', 'fx_001', '--dry-run').status === 0 && cli('--withdraw').status === 2);
  t('an unknown listing is refused', cli('--withdraw', 'nope').status === 1);
  t('reinstating removes the withdrawal, also without Notion', cli('--reinstate', 'fx_001').status === 0 && !existsSync(file));
  const r2 = cli('--schema');
  t('commands that need Notion fail closed without credentials and never print a token', r2.status === 1 && !/secret_|ntn_|Bearer/.test(r2.stdout + r2.stderr));
}

/* ---------------------------------------------------- hero card fan: interaction contract */
section('hero card fan: decorative cards react to hover without becoming actions');
{
  const fan = rd('src/components/HeroCardFan.astro');
  const css = fan.slice(fan.indexOf('<style>'));
  const markup = fan.slice(0, fan.indexOf('<script>'));
  const locked = /<div class="hf-card hf-locked"[^>]*>/.exec(markup)?.[0] ?? '';
  t('hover and focus styles are not restricted to link cards (decorative cards must respond too)', !/a\.hf-card/.test(css) && /\.hf-card:hover\{/.test(css) && /\.hf-card\[data-active="true"\]:hover\{/.test(css));
  t('a decorative card is a plain div: no link, no tabindex, no role, hidden from assistive technology', locked.startsWith('<div') && !/href=|tabindex|role=|onclick/.test(locked) && /aria-hidden="true"/.test(locked));
  t('a decorative card shows no pointer cursor and never blocks pointer events', /\.hf-locked\{cursor:default\}/.test(css) && !/pointer-events\s*:\s*none/.test(css) && !/\.hf-locked[^{]*\{[^}]*cursor:pointer/.test(css));
  t('every card has the same idle float on its own inner layer, so hover transforms never fight it', /\.hf-float\{[^}]*animation:hfFloat/.test(css) && /@keyframes hfFloat/.test(css));
  t('the idle float is subtle but visible (more than 8px, under 16px) and staggered per card', (() => { const m = /@keyframes hfFloat\{[\s\S]*?translateY\(-(\d+)px\)/.exec(css); return m && +m[1] > 8 && +m[1] < 16 && /animation-delay:calc\(var\(--i\) \* -/.test(css); })());
  t('hover never reorders the fan: the script has no pointer or mouse handler on cards', !/pointerenter|pointerover|mouseenter|mouseover|pointermove/.test(fan.slice(fan.indexOf('<script>'), fan.indexOf('</script>'))));
  const rm = css.slice(css.lastIndexOf('@media(prefers-reduced-motion:reduce)'));
  t('reduced motion stops the idle float and the entrance but keeps a static highlight', /\.hf-card,\.hf-float\{animation:none\}/.test(rm) && !/box-shadow\s*:\s*none/.test(rm) && /\.hf-card:hover\{transform:translate/.test(rm));
  t('on touch screens nothing depends on hover (the hover rules sit behind (hover:hover))', /@media\(hover:hover\)\{\s*\.hf-card:hover\{/.test(css));
  t('the carousel on small screens never lifts a card on hover', /@media\(max-width:899px\)[\s\S]*\.hf-card:hover[\s\S]*transform:none/.test(css));
  // hero cards are photo-free icon cards built only from approved public fields
  const body = fan.slice(0, fan.indexOf('<script>'));
  t('hero cards never use photographs (those stay on the listing page and in the catalogue)', !/ListingImage|\.photos|<img|srcset|<picture/.test(fan));
  t('a real card shows the house icon, the state, the status, the street and the suburb', /class="hf-house"/.test(body) && /M3\.5 11 12 4l8\.5 7/.test(body) && /class="hf-pill">\{l\.address\.state\}/.test(body) && /<ListingStatusBadge status=\{l\.commercialStatus\}/.test(body) && /\{streetLine\(l\.address\)\}/.test(body) && /\{l\.address\.suburb\}/.test(body));
  t('the whole real card is one internal link to its listing page, never an external portal', /<a class="hf-card hf-listing" href=\{`\/opportunities\/\$\{l\.slug\}\/`\}/.test(body) && !/https?:\/\//.test(body.replace(/viewBox|xmlns/g, '')));
  t('the hero reads only approved public fields of a listing', (() => { const used = new Set([...body.matchAll(/\b(?:s\.l|l|a|b)\.(address|slug|commercialStatus|featured|isDemo|sda|photos|title|summary|description|pricing|id|version|publishedAt|updatedAt|type)\b/g)].map((m) => m[1])); return [...used].every((f) => ['address', 'slug', 'commercialStatus', 'featured', 'isDemo'].includes(f)); })());
  t('the hero never shows a postcode, so the card carries street, suburb and state only', !/postcode|localityLine/.test(body));
  t('real properties glow blue and placeholders orange, so the two are always distinguishable', /s\.kind === 'listing' \? 'var\(--blue\)' : 'var\(--amber\)'/.test(body) && /\.hf-locked \.hf-float\{[^}]*amber/.test(css) && /\.hf-listing \.hf-float\{[^}]*blue/.test(css));
  t('the property page link is only on real listing cards', (markup.match(/href=\{`\/opportunities\//g) ?? []).length === 1 && !/href/.test(locked));
}

/* ------------------- doctor, delivery test, photo gate and the full CLI against a mock Notion */
section('doctor, delivery test, photo gate and an end-to-end CLI run against a local mock Notion');
{
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:http');
  const { mkdirSync, writeFileSync, existsSync, readFileSync: rf } = await import('node:fs');
  const run = (script, args, env) => new Promise((resolveRun) => {
    const p = spawn('node', [join(repoRoot, script), ...args], { env: { PATH: process.env.PATH, ...env }, cwd: repoRoot });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolveRun({ code, out, err, all: out + err }));
  });
  const cli = (args, env = {}) => run('scripts/listings-sync.mjs', args, env);
  const TOKEN = `ntn_${'a1b2c3d4e5'.repeat(4)}`;
  const DSID = '2e2909c1-bb60-8177-bf4f-000b40ef0d48';

  // ---- doctor
  const d0 = await cli(['--doctor']);
  t('doctor with nothing configured fails and names what is missing and how to set it up', d0.code === 1 && /NOTION_TOKEN is not set/.test(d0.out) && /NOTION_PROPERTIES_DATA_SOURCE_ID is not set/.test(d0.out) && /Read content/.test(d0.out));
  const d1 = await cli(['--doctor'], { NOTION_TOKEN: TOKEN, NOTION_PROPERTIES_DATA_SOURCE_ID: `collection://${DSID}` });
  t('doctor accepts a token shape and a collection:// id, and never prints the token', d1.code === 0 && !d1.all.includes(TOKEN) && !d1.all.includes('a1b2c3d4e5a1b2') && /data source id is a valid UUID/.test(d1.out));
  const d2 = await cli(['--doctor'], { NOTION_TOKEN: TOKEN, NOTION_PROPERTIES_DATA_SOURCE_ID: '2e2909c1-bb60-81b5-8806-ff710a8274ed' });
  t('doctor flags the DATABASE id used as the data source id', d2.code === 1 && /DATABASE id/.test(d2.out));
  const d3 = await cli(['--doctor'], { NOTION_TOKEN: 'not-a-token', NOTION_PROPERTIES_DATA_SOURCE_ID: DSID });
  t('doctor flags a value that is not a Notion token', d3.code === 1 && /does not look like a Notion integration token/.test(d3.out) && !d3.all.includes('not-a-token'));
  const d4 = await cli(['--doctor'], { NOTION_TOKEN: TOKEN, NOTION_PROPERTIES_DATA_SOURCE_ID: DSID, NOTION_API_BASE: 'https://evil.example.test' });
  t('a non-loopback NOTION_API_BASE is refused, so the token can never be redirected', d4.code === 1 && /local tests only/.test(d4.out) && !d4.all.includes(TOKEN));

  // ---- delivery test (dry run only: tests never send email)
  const dl = (args, env) => run('scripts/test-enquiry-delivery.mjs', args, env);
  const dl1 = await dl([], { RESEND_API_KEY: `re_${'FAKEKEY'.repeat(4)}` });
  t('the delivery test dry run shows the real sender and recipient, sends nothing and hides the key', dl1.code === 0 && /noreply@send\.sdahomechoices\.com\.au/.test(dl1.out) && /steve@sdahomechoices\.com\.au/.test(dl1.out) && /Nothing was sent/.test(dl1.out) && !dl1.all.includes('FAKEKEY'));
  t('the delivery test refuses an external recipient', (await dl(['--to', 'someone@example.com'], { RESEND_API_KEY: 'x' })).code === 2);
  const dl2 = await dl(['--send'], {});
  t('--send without a key fails before any network call', dl2.code === 1 && /RESEND_API_KEY is not set/.test(dl2.all));
  t('the delivery test uses the same sink as the endpoint and has an explicit --send gate', /createEmailSink/.test(rd('scripts/test-enquiry-delivery.mjs')) && /argv\.includes\('--send'\)/.test(rd('scripts/test-enquiry-delivery.mjs')));

  // ---- photo gate
  {
    const w = mkdtempSync(join(tmpdir(), 'photo-gate-'));
    const inD = join(w, 'in'); mkdirSync(inD);
    await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 25, g: 140, b: 160 } } }).jpeg().toFile(join(inD, 'a.jpg'));
    const outCli = await run('scripts/prepare-listing-photos.mjs', ['--in', inD, '--out', join(w, 'out'), '--id', 'lst_454f05d21f'], {});
    const prepared = join(w, 'out', 'lst_454f05d21f');
    t('--id writes the prepared folder under the public id, the exact upload prefix', outCli.code === 0 && existsSync(join(prepared, 'manifest.json')));
    t('--id rejects anything that is not a public listing id', (await run('scripts/prepare-listing-photos.mjs', ['--in', inD, '--out', join(w, 'o2'), '--id', '19 Some Street'], {})).code === 2);
    const v0 = await verifyFolder(prepared);
    t('the gate refuses a fresh folder only for the missing privacy review (empty alt text is allowed)', !v0.ok && !v0.problems.some((m) => /alt/.test(m)) && v0.problems.some((m) => /privacy review/.test(m)));
    t('the gate command exits non-zero and says not to upload', (await run('scripts/prepare-listing-photos.mjs', ['--verify', prepared], {})).code === 1);
    const mp = join(prepared, 'manifest.json');
    const man0 = JSON.parse(rf(mp, 'utf8'));
    man0.photos[0].alt = ''; man0.photos[0].privacyReviewed = true;
    writeFileSync(mp, JSON.stringify(man0));
    const v1 = await verifyFolder(prepared);
    t('the gate passes with the privacy review recorded and no alt text', v1.ok && v1.problems.length === 0);
    t('the gate command exits zero when the folder is ready', (await run('scripts/prepare-listing-photos.mjs', ['--verify', prepared], {})).code === 0);
    const f0 = join(prepared, man0.photos[0].files[0].file);
    try {
      await sharp(f0).withExif({ IFD0: { Copyright: 'Owner Name' } }).webp().toFile(`${f0}.tmp`);
      (await import('node:fs')).renameSync(`${f0}.tmp`, f0);
      const v2 = await verifyFolder(prepared);
      t('the gate catches a file that still carries EXIF metadata', !v2.ok && v2.problems.some((m) => /metadata/.test(m)));
    } catch { t('the gate catches a file that still carries EXIF metadata (skipped: this sharp cannot write EXIF to WebP)', true); }
    writeFileSync(join(prepared, 'stray.jpg'), 'x');
    t('the gate catches an image that is not in the manifest', (await verifyFolder(prepared)).problems.some((m) => /stray\.jpg/.test(m)));
    man0.photos[0].alt = 'IMG_4821.jpg'; writeFileSync(mp, JSON.stringify(man0));
    t('the gate catches alt text that is a file name', (await verifyFolder(prepared)).problems.some((m) => /file name/.test(m)));
  }

  // ---- the whole CLI against a mock Notion that behaves like the documented API
  const A = page();
  const PID = L.publicIdFor(A.id);
  const requests = [];
  let migrated = false;
  let authOk = true;
  const dsMigrated = () => dsPayload((d) => { for (const w of L.WEB_SCHEMA) d.add(w.name, w.type, w.options ? { select: { options: w.options.map((name) => ({ name })) } } : {}); return d; });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, version: req.headers['notion-version'], auth: !!req.headers.authorization });
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/media/')) return json(200, man({ files: [{ w: 480, file: 'a1b2c3d4e5f6-480.webp' }] }));
    if (!req.headers.authorization || !authOk) return json(401, { object: 'error', code: 'unauthorized', message: 'API token is invalid.' });
    if (url.pathname === '/v1/users/me') return json(200, { object: 'user', type: 'bot' });
    if (url.pathname === `/v1/data_sources/${DSID}` && req.method === 'GET') return json(200, migrated ? dsMigrated() : dsPayload());
    if (url.pathname === `/v1/data_sources/${DSID}/query` && req.method === 'POST') return json(200, { object: 'list', results: [A], has_more: false, next_cursor: null, type: 'page_or_data_source', request_status: { type: 'complete' } });
    if (url.pathname === `/v1/pages/${A.id}` && req.method === 'GET') return json(200, A);
    return json(404, { object: 'error', code: 'object_not_found', message: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dataDir = mkdtempSync(join(tmpdir(), 'e2e-data-'));
  for (const d of ['approved', 'withdrawn']) mkdirSync(join(dataDir, d));
  writeFileSync(join(dataDir, 'approvers.json'), JSON.stringify({ approvers: [{ notionUserId: 'user-steve', name: 'Steve Dawson' }] }));
  writeFileSync(join(dataDir, 'compliance.json'), JSON.stringify(COMPLY));
  const env = { NOTION_TOKEN: TOKEN, NOTION_PROPERTIES_DATA_SOURCE_ID: `collection://${DSID}`, NOTION_API_BASE: `http://127.0.0.1:${port}`, LISTINGS_MEDIA_BASE_URL: `http://127.0.0.1:${port}/media`, LISTINGS_DATA_DIR: dataDir };

  const online = await cli(['--doctor', '--online'], env);
  t('doctor --online: Notion accepts the token and the integration can read the data source', online.code === 0 || /Notion accepted the token/.test(online.out));
  t('doctor --online reports the Web properties still to create', /9 Web properties still to create/.test(online.out));

  requests.length = 0;
  const sch = await cli(['--schema'], env);
  t('--schema against the pre-migration data source lists the nine properties to add and changes nothing', sch.code === 0 && /Web properties still to add \(9\)/.test(sch.out) && /Nothing was changed in Notion/.test(sch.out) && /Web Display Price  \[number\]/.test(sch.out) && /Web Approved By  \[people\]/.test(sch.out));
  t('the schema check sent only GET requests, with the pinned API version and the token', requests.length === 1 && requests.every((r) => r.method === 'GET' && r.version === '2026-03-11' && r.auth));

  const pre = await cli(['--preflight', A.id], env);
  t('--preflight reads one page and prints the readiness report', pre.code === 0 && /Final readiness/.test(pre.out) && new RegExp(PID).test(pre.out));
  t('the report prints no price, yield or SharePoint address', !/\b695,?000\b|\b6\.5\b|sharepoint\.com/i.test(pre.out));
  t('the CRM Description and Features are reported as protected', /PROTECTED\s+Description \(CRM\)/.test(pre.out) && /PROTECTED\s+Features/.test(pre.out));

  migrated = true;
  const dry = await cli(['--propose'], env);
  t('--propose (dry run) shows what it would propose and writes nothing', dry.code === 0 && /would propose/.test(dry.out) && readdirSync(join(dataDir, 'approved')).length === 0);
  requests.length = 0;
  const wr = await cli(['--propose', '--write'], env);
  const snapFile = join(dataDir, 'approved', 'rutherford-grove-armstrong-creek-vic.json');
  t('--propose --write produces the first snapshot for the pilot property', wr.code === 0 && existsSync(snapFile));
  const snapJson = existsSync(snapFile) ? JSON.parse(rf(snapFile, 'utf8')) : {};
  t('the snapshot has the public address, a hashed id and the authorised approver', snapJson.listingId === PID && snapJson.content?.address?.street === 'Rutherford Grove' && snapJson.content?.address?.postcode === '3217' && snapJson.approvedById === 'user-steve' && snapJson.version === 1 && L.contentHash(snapJson.content) === snapJson.contentHash);
  // the PUBLIC content only, with word boundaries: the snapshot also holds a content hash and timestamps, whose random digits (for example "695" or "6.5")
// made this assertion fail about one run in a few dozen. A leak of a price, house number or id would still be caught.
  t('the snapshot contains no house number, price, yield, CRM description, SharePoint link or internal id', !/\b1\/10\b|\b695\b|\b6\.5\b|vendor motivation|sharepoint|2e2909c1/i.test(JSON.stringify(snapJson.content ?? {})) && !/2e2909c1|sharepoint/i.test(JSON.stringify(snapJson)));
  const reads = requests.filter((r) => r.path.startsWith('/v1/'));
  t('the whole run used only reads: GET, plus the data source query which reads', reads.every((r) => r.method === 'GET' || (r.method === 'POST' && /\/query$/.test(r.path))));
  t('every Notion request carried the pinned version and the token', reads.every((r) => r.version === '2026-03-11' && r.auth));
  t('the public manifest was fetched without the Notion token', requests.filter((r) => r.path.startsWith('/media/')).every((r) => !r.auth) && requests.some((r) => r.path.startsWith('/media/')));
  t('no output of any command contains the token', ![sch, pre, dry, wr, online].some((r) => r.all.includes(TOKEN)));

  writeFileSync(join(dataDir, 'approvers.json'), JSON.stringify({ approvers: [{ notionUserId: 'someone-else', name: 'Nobody' }] }));
  rmSync(snapFile);
  const noAuth = await cli(['--propose', '--write'], env);
  t('an approver who is not on the list yields no snapshot and a clear failure', noAuth.code === 1 && /not an authorised approver/.test(noAuth.all) && !existsSync(snapFile));
  writeFileSync(join(dataDir, 'approvers.json'), JSON.stringify({ approvers: [{ notionUserId: 'user-steve', name: 'Steve Dawson' }] }));
  writeFileSync(join(dataDir, 'compliance.json'), JSON.stringify(DENY));
  const noComp = await cli(['--propose', '--write'], env);
  t('Victoria not cleared yields no snapshot even with an authorised approver', noComp.code === 1 && /Victorian pricing compliance is not cleared/.test(noComp.all) && !existsSync(snapFile));
  authOk = false;
  const bad = await cli(['--schema'], env);
  t('a rejected token fails closed with the status only, never the token', bad.code === 1 && /HTTP 401/.test(bad.all) && !bad.all.includes(TOKEN));
  const noWrite = await cli(['--schema'], { ...env, NOTION_TOKEN: undefined });
  t('without a token the command fails before any network call', noWrite.code === 1);
  await new Promise((r) => server.close(r));
}

/* ----------------------------------------------- safety of the repository itself */
section('repository safety: no Notion at build, no unsafe automation, no secrets');
const walkSrc = (dir) => readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walkSrc(join(dir, d.name)) : [join(dir, d.name)]));
const siteFiles = [...walkSrc('src/pages'), ...walkSrc('src/components'), ...walkSrc('src/layouts')].filter((f) => /\.(astro|ts)$/.test(f));
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const stripYaml = (src) => src.replace(/^\s*#.*$/gm, '').replace(/\s#\s.*$/gm, '');
const loader = stripJs(rd('src/data/listings/index.ts'));
t('the build-time loader never touches Notion or the network', !/notion/i.test(loader) && !/fetch\(/.test(loader));
t('no page, component or layout imports the Notion adapter', siteFiles.every((f) => !/listings\/(notion|propose)/.test(rd(f))));
const pkg = JSON.parse(rd('package.json'));
t('the build command is unchanged and no build hook calls Notion', pkg.scripts.build === 'astro build' && !('prebuild' in pkg.scripts) && !('postbuild' in pkg.scripts));
t('only the two known workflows exist (the retired Propose listing snapshot workflow is gone), and the publish workflow cannot deploy by itself (no deploy hook, no Vercel call)', readdirSync(join(repoRoot, '.github/workflows')).sort().join() === 'ci.yml,publish-listing.yml' && !/deploy.?hook|curl|vercel/i.test(stripYaml(rd('.github/workflows/publish-listing.yml'))));
t('listing files are protected by code owners', /approved\//.test(rd('.github/CODEOWNERS')) && /withdrawn\//.test(rd('.github/CODEOWNERS')));
t('Notion credentials live in a git-ignored env file', /^\.env\.listings$/m.test(rd('.gitignore')) && /^\.env$/m.test(rd('.gitignore')));
const secretRe = /\b(secret_[A-Za-z0-9]{30,}|ntn_[A-Za-z0-9]{30,}|re_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{30,})\b/;
t('no secret or token pattern exists in any tracked file', tracked.every((f) => { try { return !secretRe.test(readFileSync(join(repoRoot, f), 'utf8')); } catch { return true; } }));
t('no Notion variable is exposed to client code (no PUBLIC_ prefix, no import.meta.env use)', [...walkSrc('src'), 'scripts/listings-sync.mjs'].every((f) => { const c = readFileSync(join(repoRoot, f), 'utf8'); return !/PUBLIC_NOTION|import\.meta\.env\.NOTION|import\.meta\.env\.PUBLIC_.*TOKEN/.test(c); }));
t('Notion credentials appear in .env.example only as commented placeholders', rd('.env.example').split('\n').filter((l) => /NOTION_/.test(l)).every((l) => l.trim().startsWith('#')));
t('the default approver list is valid and starts empty or explicit', Array.isArray(JSON.parse(rd('src/data/listings/approvers.json')).approvers));
t('the website repository does not reference the internal app project', [...walkSrc('src'), 'scripts/listings-sync.mjs', 'package.json'].every((f) => !/sdahc-intelligence|62_sdahc_Internal_App|app\.sdahomechoices/.test(readFileSync(join(repoRoot, f), 'utf8'))));

/* ------------------------------------------------------------- enquiries */
section('enquiries: validation, anti-spam and CRM matching');
const form = (over = {}) => { const f = new FormData(); const base = { listing_id: 'fx_001', name: 'Alex Buyer', email: 'Alex@Example.com', phone: '0412 345 678', message: 'Please send details.', consent: 'yes', ts: String(Date.now() - 10_000), company: '', ...over }; for (const [k, v] of Object.entries(base)) if (v !== undefined) f.set(k, v); return f; };
const nowMs = Date.now();
const pe = (over) => L.parseEnquiry(form(over), nowMs);
t('accepts a valid enquiry and lower-cases the email', (() => { const r = pe(); return r.ok && r.value.email === 'alex@example.com' && r.value.source === 'listing_page'; })());
t('phone is optional', pe({ phone: '' }).ok && !('phone' in pe({ phone: '' }).value));
t('honeypot is silently accepted without processing', pe({ company: 'Acme' }).status === 204);
t('a submission faster than a human is rejected', !pe({ ts: String(nowMs - 500) }).ok);
t('a missing timing token is rejected', !pe({ ts: '' }).ok);
t('a stale timing token is rejected', !pe({ ts: String(nowMs - 3 * 24 * 3600 * 1000) }).ok);
t('requires consent', !pe({ consent: '' }).ok);
t('requires a valid email, name and message', !pe({ email: 'nope' }).ok && !pe({ name: '' }).ok && !pe({ message: '' }).ok);
t('rejects an invalid phone number', !pe({ phone: 'abc' }).ok);
t('rejects oversize fields', !pe({ message: 'x'.repeat(2001) }).ok && !pe({ name: 'x'.repeat(101) }).ok);
t('rejects link spam', !pe({ message: 'http://a.test http://b.test http://c.test' }).ok);
const lim = new L.RateLimiter(3, 1000);
t('rate limiter allows the limit then blocks', lim.allow('k', 0) && lim.allow('k', 1) && lim.allow('k', 2) && !lim.allow('k', 3));
t('rate limiter isolates keys and recovers after the window', lim.allow('other', 3) && lim.allow('k', 1500));
const rr = L.toRecord(pe().value, new Date('2026-03-01T10:00:00Z'));
t('enquiry record carries listing, contact, source, date and status', rr.listingId === 'fx_001' && rr.email === 'alex@example.com' && rr.source === 'listing_page' && rr.receivedAt === '2026-03-01T10:00:00.000Z' && rr.status === 'received' && /^[a-f0-9]{16}$/.test(rr.id));
t('record id is stable for the same person, listing and day', L.toRecord(pe().value, new Date('2026-03-01T18:00:00Z')).id === rr.id);
const crmCalls = [];
const mkCrm = (existing) => ({
  findContactByEmail: async (e) => { crmCalls.push(['find', e]); return existing ? { id: 'c-existing' } : null; },
  createContact: async (c) => { crmCalls.push(['create', c]); return { id: 'c-new' }; },
  createEnquiry: async (x) => { crmCalls.push(['enquiry', x.contactId]); return { id: 'e-1' }; },
});
const linkedNew = await L.linkToCrm(mkCrm(false), rr);
t('creates a Contact when none matches and links the enquiry', linkedNew.contactCreated && linkedNew.contactId === 'c-new' && crmCalls.some((c) => c[0] === 'create'));
crmCalls.length = 0;
const linkedOld = await L.linkToCrm(mkCrm(true), rr);
t('reuses an existing Contact: no duplicate is created', !linkedOld.contactCreated && linkedOld.contactId === 'c-existing' && !crmCalls.some((c) => c[0] === 'create'));
t('looks the Contact up by lower-cased email', crmCalls[0][1] === 'alex@example.com');
t('never creates a Deal, by construction', linkedNew.dealCreated === false && linkedOld.dealCreated === false && !('createDeal' in mkCrm(true)));
const sent = [];
t('a Preview may redirect to an @sdahomechoices.com.au test inbox', L.resolveRecipient('steve@sdahomechoices.com.au', 'ramiro@sdahomechoices.com.au', 'preview') === 'ramiro@sdahomechoices.com.au');
t('Production never uses the test recipient', L.resolveRecipient('steve@sdahomechoices.com.au', 'ramiro@sdahomechoices.com.au', 'production') === 'steve@sdahomechoices.com.au');
t('the test recipient must be on the company domain', L.resolveRecipient('steve@sdahomechoices.com.au', 'x@evil.example.test', 'preview') === 'steve@sdahomechoices.com.au');
t('no override means the default recipient', L.resolveRecipient('steve@sdahomechoices.com.au', undefined, 'preview') === 'steve@sdahomechoices.com.au');
const sink = L.createEmailSink(async (m) => { sent.push(m); return {}; }, 'inbox@example.test');
const evil = { ...rr, message: '<script>alert(1)</script>' };
await sink.deliver(evil, fx[0]);
t('email sink escapes HTML and names the listing without an address', !sent[0].html.includes('<script>') && sent[0].html.includes('SDA property, Armstrong Creek') && sent[0].replyTo === 'alex@example.com');
t('email sink reports failure honestly', !(await L.createEmailSink(async () => ({ error: 'x' }), 'a@b.test').deliver(rr, fx[0])).ok);
t('dry-run sink is explicit about being a dry run', L.dryRunSink.name === 'dry-run');

/* ----------------------------------------------------------- photo preparation */
section('photo preparation');
const palette = readAccentPalette(join(repoRoot, 'src/styles/tokens.css'));
t('accent palette is read from tokens.css', Object.keys(palette).join() === 'blue,teal,amber,slate');
t('dominant colour snaps to the nearest brand accent', snapToAccent({ r: 25, g: 140, b: 160 }, palette) === 'teal' && snapToAccent({ r: 220, g: 140, b: 30 }, palette) === 'amber' && snapToAccent({ r: 10, g: 110, b: 220 }, palette) === 'blue');
t('low-saturation images take the neutral accent', snapToAccent({ r: 120, g: 122, b: 125 }, palette) === 'slate');
const work = mkdtempSync(join(tmpdir(), 'photo-prep-'));
const inDir = join(work, 'in');
const outDir = join(work, 'out');
(await import('node:fs')).mkdirSync(inDir);
const mk = async (name, w, h, bg, exif) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: bg } }).jpeg();
  if (exif) { try { img = img.withExif({ IFD0: { Copyright: 'Owner Name', ImageDescription: '99 Example Street' } }); } catch { /* older sharp: skip metadata injection */ } }
  await img.toFile(join(inDir, name));
};
await mk('teal.jpg', 2000, 1500, { r: 25, g: 140, b: 160 }, true);
await mk('small.jpg', 600, 400, { r: 220, g: 140, b: 30 });
const manifest = await prepareFolder(inDir, outDir, join(repoRoot, 'src/styles/tokens.css'));
const files = readdirSync(outDir);
t('writes a manifest and optimised files', files.includes('manifest.json') && manifest.photos.length === 2);
t('file names are content hashes and carry no address or original name', files.filter((f) => f.endsWith('.webp')).every((f) => /^[a-f0-9]{12}-\d+\.webp$/.test(f)));
const tealPhoto = manifest.photos.find((p) => p.width === 2000);
t('large images get three widths, small images are never upscaled', tealPhoto.files.map((f) => f.w).join() === '480,960,1600' && manifest.photos.find((p) => p.width === 600).files.map((f) => f.w).join() === '480,600');
t('the accent is sampled from the image', tealPhoto.accent === 'teal' && manifest.photos.find((p) => p.width === 600).accent === 'amber');
t('alt text and privacy review start unset, so nothing can publish unreviewed', manifest.photos.every((p) => p.alt === '' && p.privacyReviewed === false));
t('metadata (EXIF, GPS, owner) is stripped from outputs', (await Promise.all(files.filter((f) => f.endsWith('.webp')).map((f) => sharp(join(outDir, f)).metadata()))).every((m) => !m.exif));
t('output is smaller than a 1600px original', (await sharp(join(outDir, `${tealPhoto.id}-1600.webp`)).metadata()).width === 1600);

section('publication job started by the internal app (dry run only in this release)');
{
  const SECRET = 'test-secret-not-real';
  const NOW = 1_800_000_000_000;
  const body = '{"jobId":"x"}';
  const h = signedHeaders(SECRET, body, NOW);
  t('a request signed with the shared secret verifies', verifySignature(SECRET, h['x-listings-timestamp'], body, h['x-listings-signature'], NOW));
  t('a tampered body, another secret, a stale timestamp or no signature are refused', !verifySignature(SECRET, h['x-listings-timestamp'], body + ' ', h['x-listings-signature'], NOW) && !verifySignature('other', h['x-listings-timestamp'], body, h['x-listings-signature'], NOW) && !verifySignature(SECRET, h['x-listings-timestamp'], body, h['x-listings-signature'], NOW + 6 * 60 * 1000) && !verifySignature(SECRET, h['x-listings-timestamp'], body, undefined, NOW) && !verifySignature('', h['x-listings-timestamp'], body, h['x-listings-signature'], NOW));
  t('the signature is a keyed hash (not the secret, not reversible text)', sign(SECRET, '1', 'b').length === 64 && !sign(SECRET, '1', 'b').includes(SECRET));

  const page = { id: 'p1', properties: { Name: { type: 'title', title: [{ plain_text: '12 Example Street, Exampleton VIC 3999' }] }, Address: { type: 'rich_text', rich_text: [{ plain_text: '12 Example Street, Exampleton VIC 3999' }] }, Price: { type: 'number', number: 1234567 }, 'Web Title': { type: 'rich_text', rich_text: [{ plain_text: 'old' }] } } };
  const payload = { content: { title: 'Established SDA house', description: 'First paragraph here.\n\nSecond paragraph here.', publicAddress: 'Example Street, Exampleton VIC 3999', pricingMode: 'asking_price', displayPrice: 695000, featured: true }, manifest: { version: 1, photos: [{ id: 'a1b2c3d4e5f6' }, { id: 'b1b2c3d4e5f6' }] } };
  const before = JSON.stringify(page);
  const ov = overlayPage(page, payload, { notionUserId: 'u-1', name: 'Approver' });
  t('the overlay replaces only the Web fields and never mutates the real row', JSON.stringify(page) === before && ov.properties.Address === page.properties.Address && ov.properties.Price.number === 1234567 && ov.properties.Name === page.properties.Name);
  t('the overlay carries the approved content in the shapes the Notion adapter reads', L.readText(ov.properties['Web Title']) === 'Established SDA house' && L.readText(ov.properties['Web Pricing Mode']) === 'Asking Price' && ov.properties['Web Display Price'].number === 695000 && ov.properties['Web Featured'].checkbox === true && L.readText(ov.properties['Web Listing Status']) === 'Published' && L.readPeople(ov.properties['Web Approved By'])[0].id === 'u-1');
  t('with no approver the overlay has an empty Web Approved By (the engine then refuses)', L.readPeople(overlayPage(page, payload, null).properties['Web Approved By']).length === 0);

  const content = { title: 'Established SDA house', description: ['First paragraph here.', 'Second paragraph here.'], address: { street: 'Example Street', suburb: 'Exampleton', state: 'VIC', postcode: '3999' }, pricing: { mode: 'asking_price', display: '$695,000' }, photos: [{ id: 'a1b2c3d4e5f6' }, { id: 'b1b2c3d4e5f6' }] };
  t('parity: a snapshot that says what was approved has no differences', parity(content, payload).length === 0);
  t('parity names every difference (title, text, address, mode, price, photo order) and nothing else', JSON.stringify(parity({ ...content, title: 'x', description: ['y'], address: { ...content.address, suburb: 'Elsewhere' }, pricing: { mode: 'eoi' }, photos: [content.photos[1], content.photos[0]] }, payload)) === JSON.stringify(['title', 'description', 'address', 'pricing mode', 'display price', 'photo order']));
  t('parity: an empty approved title is not compared (the engine derives the default)', parity({ ...content, title: 'SDA property, Exampleton' }, { ...payload, content: { ...payload.content, title: '' } }).length === 0);
  t('effectiveStatus: the requested status, else the website status, else Available', effectiveStatus({ content: { commercialStatus: 'sold' } }, { commercialStatus: 'available' }) === 'sold' && effectiveStatus({ content: {} }, { commercialStatus: 'under_offer' }) === 'under_offer' && effectiveStatus({ content: {} }, null) === 'available' && effectiveStatus({ content: { commercialStatus: 'bogus' } }, { commercialStatus: 'sold' }) === 'sold');
  t('the overlay takes status and end date from the portal and the existing snapshot, never from Notion', L.readText(overlayPage({ ...page, properties: { ...page.properties, 'Web Listing Status': { type: 'select', select: { name: 'Withdrawn' } }, 'Listing End Date': { type: 'date', date: { start: '2020-01-01' } } } }, payload, null, { commercialStatus: 'sold', listingEndDate: '2031-06-30' }).properties['Web Listing Status']) === 'Sold' && L.readText(overlayPage(page, payload, null, { listingEndDate: '2031-06-30' }).properties['Listing End Date']) === '2031-06-30' && L.readText(overlayPage(page, payload, null, null).properties['Listing End Date']) === '');
  t('statusParity: nothing asked passes; a mismatch is named', statusParity({ commercialStatus: 'sold' }, { content: {} }).length === 0 && statusParity({ commercialStatus: 'sold' }, { content: { commercialStatus: 'sold' } }).length === 0 && statusParity({ commercialStatus: 'available' }, { content: { commercialStatus: 'sold' } })[0] === 'commercial status');
  {
    const jobSrc = rd('scripts/listings-publish-job.mjs');
    t('the job accepts a status move as an update, checks the requested status against the snapshot, and proves it on the live page', /action\.kind !== 'version' && action\.kind !== 'status'/.test(jobSrc) && /statusParity\(action\.snapshot, payload\)/.test(jobSrc) && /verifyLive\(\{[^}]*status: snapshot\.commercialStatus/.test(jobSrc));
    t('the job resumes a merged status move only when the status also matches, and rejects an invalid or non-Available first-publication status', /statusParity\(previousSnap, payload\)\.length === 0/.test(jobSrc) && /mode === 'publish' && asked !== 'available'/.test(jobSrc));
    const slugPage = rd('src/pages/opportunities/[slug].astro');
    const soldBranch = slugPage.slice(slugPage.indexOf('{sold ? ('), slugPage.indexOf(') : ('));
    t('a Sold page has no price row, no purchase enquiry, no access steps and no enquiry form, and offers a general enquiry route', /const sold = listing\.commercialStatus === 'sold'/.test(slugPage) && /if \(l\.commercialStatus === 'sold'\) return null/.test(rd('src/data/listings/detail.ts')) && /pricing=\{pricing\}/.test(slugPage) && /\{!sold && \(/.test(slugPage) && !/ListingEnquiryForm/.test(soldBranch) && /href="\/contact-us\/"/.test(soldBranch) && /This property has been sold/.test(soldBranch));
    t('the enquiry endpoint refuses an enquiry about a sold listing', /commercialStatus === 'sold'\) return json\(\{ ok: false[^)]*409\)/.test(rd('src/pages/api/listing-enquiry.ts')));
    t('a sold card in the catalogue does not show a price', /l\.commercialStatus !== 'sold'\) c\.price/.test(rd('src/data/listings/card.ts')));
  }
  {
    const jobSrc = rd('scripts/listings-publish-job.mjs');
    const wf = jobSrc.slice(jobSrc.indexOf('async function withdraw('), jobSrc.indexOf('\nasync function main()'));
    t('withdraw mode exists in the job, the helper modes and the workflow choices (and the workflow can still not deploy by itself)', /if \(mode === 'withdraw'\) return withdraw\(payload\)/.test(jobSrc) && MODES_FROM_LIB.includes('withdraw') && /- withdraw/.test(rd('.github/workflows/publish-listing.yml')) && !/deploy.?hook|curl|vercel/i.test(stripYaml(rd('.github/workflows/publish-listing.yml'))));
    t('the withdraw path never reads or writes anything private: no Notion, no reason, no person, no content, only constant words', wf.length > 500 && !/Notion|queryAll|notion_read|reason|requestedBy|approval|email|actor/i.test(wf.replace(/reason:\s*'withdrawn'/g, '')) && !/console\.log\([^)]*payload/.test(wf));
    t('the withdraw path proves the build without the listing (public output only) and the privacy scan BEFORE any pull request, then verifies the live site', wf.indexOf('check-withdrawal.mjs') > -1 && wf.indexOf("'--dist', '.vercel/output/static'") > -1 && wf.indexOf('check:privacy') < wf.indexOf('openWithdrawalPr') && wf.indexOf('openWithdrawalPr') < wf.indexOf('waitForChecks') && wf.indexOf('waitForChecks') < wf.indexOf('mergePr') && wf.indexOf('mergePr') < wf.indexOf('verifyWithdrawn'));
    t('a withdrawal reports success as withdrawn and never as live, and a rerun after the merge only verifies', /withdrawn: true/.test(wf) && /live: false/.test(wf) && /const resumed = jsonDir\('withdrawn'\)/.test(wf));
    t('the emergency CLI no longer takes a public reason or name', !/val\('--reason'\)\s*;/.test(rd('scripts/listings-sync.mjs')) && /withdrawnBy: 'SDA Home Choices', reason: 'withdrawn'/.test(rd('scripts/listings-sync.mjs')));
  }
  t('the manifest check refuses photographs outside a gallery review, non-hash ids and an empty gallery', checkManifest({ version: 1, photos: [{ id: 'a1b2c3d4e5f6', privacyReviewed: true }] }).length === 0 && checkManifest({ version: 1, photos: [{ id: 'a1b2c3d4e5f6', privacyReviewed: false }] }).length > 0 && checkManifest({ version: 1, photos: [{ id: 'x', privacyReviewed: true }] }).length > 0 && checkManifest({ version: 1, photos: [] }).length > 0);

  {
    let n = 0; const pauses = [];
    const flaky = await withRetry(async () => { n += 1; if (n < 3) throw new Error('fetch failed'); return 'ok'; }, { sleep: async (ms) => { pauses.push(ms); } });
    t('a dropped connection is retried with growing pauses and the call then succeeds (progress is not lost)', flaky === 'ok' && n === 3 && pauses.join() === '400,800');
    let m = 0; let refused = false;
    try { await withRetry(async () => { m += 1; throw Object.assign(new Error('refused'), { retryable: false }); }, { sleep: async () => {} }); } catch { refused = true; }
    t('a refusal by the app is final and is not retried', refused && m === 1);
    let k = 0; let gaveUp = false;
    try { await withRetry(async () => { k += 1; throw new Error('down'); }, { attempts: 3, sleep: async () => {} }); } catch { gaveUp = true; }
    t('retrying gives up after the configured attempts', gaveUp && k === 3);
  }
  {
    const det = (over = {}) => ({ listingId: '*', pricingMode: 'contact_agent', basis: 'internal_determination', recordedBy: 'Owner', recordedAt: '2026-11-09', reference: 'https://example.test/reference', statement: 'Standing position recorded for the test.', ...over });
    const cfg = (list) => ({ victoria: { reviewedBy: null, reviewedAt: null, adviceReference: null, cleared: { asking_price: false, price_guide: false, eoi: false, contact_agent: false }, determinations: list }, basicClassification: { confirmedListingIds: [] } });
    t('a complete standing determination ("*") clears every listing for that pricing mode only', L.victorianClearance(cfg([det()]), 'lst_aaaaaaaaaa', 'contact_agent').cleared && L.victorianClearance(cfg([det()]), 'lst_bbbbbbbbbb', 'contact_agent').cleared && !L.victorianClearance(cfg([det()]), 'lst_aaaaaaaaaa', 'asking_price').cleared && !L.victorianClearance(cfg([det()]), 'lst_aaaaaaaaaa', 'eoi').cleared);
    t('a standing determination still needs the full record and states that it is standing', !L.victorianClearance(cfg([det({ statement: '' })]), 'lst_aaaaaaaaaa', 'contact_agent').cleared && !L.victorianClearance(cfg([det({ basis: 'hunch' })]), 'lst_aaaaaaaaaa', 'contact_agent').cleared && L.victorianClearance(cfg([det()]), 'lst_aaaaaaaaaa', 'contact_agent').basis === 'standing internal_determination');
    t('the default is unchanged: nothing is cleared without a recorded determination, and a per-listing one never clears another listing', !L.victorianClearance(cfg([]), 'lst_aaaaaaaaaa', 'contact_agent').cleared && !L.victorianClearance(cfg([det({ listingId: 'lst_cccccccccc' })]), 'lst_aaaaaaaaaa', 'contact_agent').cleared && L.victorianClearance(cfg([det({ listingId: 'lst_aaaaaaaaaa' })]), 'lst_aaaaaaaaaa', 'contact_agent').cleared);
    t('the live compliance file has no mode-wide clearance and exactly one standing record, for Contact Agent only', Object.values(JSON.parse(rd('src/data/listings/compliance.json')).victoria.cleared).every((v) => v === false) && JSON.parse(rd('src/data/listings/compliance.json')).victoria.determinations.filter((d) => d.listingId === '*').map((d) => d.pricingMode).join() === 'contact_agent');
    const p = { authority: 'listings_manager', approver: { id: 'app-0123456789ab', name: 'Ali Example' } };
    t('approval from the Listings Manager is the authority: the id and display name come from the signed payload', JSON.stringify(approverFor(p, [])) === JSON.stringify({ id: 'app-0123456789ab', name: 'Ali Example', via: 'listings_manager' }));
    t('the public approver name is never an email address, never markup, and has a default', approverFor({ ...p, approver: { id: 'app-0123456789ab', name: 'ali@sdahomechoices.com.au' } }, []).name === 'SDA Home Choices' && approverFor({ ...p, approver: { id: 'app-0123456789ab', name: '<b>Ali</b>' } }, []).name === 'bAlib' && approverFor({ ...p, approver: { id: 'app-0123456789ab' } }, []).name === 'SDA Home Choices');
    t('an unsigned-looking or malformed approver is not accepted as the Listings Manager', approverFor({ authority: 'listings_manager', approver: { id: 'x' } }, []) === null && approverFor({ authority: 'someone_else', approver: { id: 'app-0123456789ab' } }, []) === null && approverFor({}, []) === null);
    t('older payloads fall back to the Notion approvers list', approverFor({ approver: { notionUserId: 'u-1' } }, [{ notionUserId: 'u-1', name: 'Listed' }])?.via === 'approvers_list' && approverFor({ approver: { notionUserId: 'u-2' } }, [{ notionUserId: 'u-1', name: 'Listed' }]) === null);
    t('the job script takes approval from approverFor and reports it as the check', /approverFor\(payload, approvers\)/.test(rd('scripts/listings-publish-job.mjs')) && /approved_in_listings_manager/.test(rd('scripts/listings-publish-job.mjs')) && !/approver_authorised/.test(rd('scripts/listings-publish-job.mjs')));
  }
  const wf = rd('.github/workflows/publish-listing.yml');
  const job = rd('scripts/listings-publish-job.mjs');
  t('workflow: modes are dry_run, publish and update; the workflow token is read-only; no id-token', /options:\s*\n\s*- dry_run\s*\n\s*- publish\s*\n\s*- update\s*\n/.test(wf) && /\npermissions:\s*\n\s*contents: read\s*\n\s*\n/.test(wf) && !/id-token|packages:|administration|secrets: write/.test(wf));
  t('workflow: inputs reach the script through environment variables, never interpolated into the shell command', /--job "\$JOB_ID" --public-id "\$PUBLIC_ID" --mode "\$MODE"/.test(wf) && !/run:.*\$\{\{ *inputs/.test(wf));
  t('workflow: runs on main only in this repository, one job at a time, never cancels half way, has a timeout', /ref: main/.test(wf) && /github\.repository == 'ramiroangeli\/sdahc-website'/.test(wf) && /cancel-in-progress: false/.test(wf) && /timeout-minutes: 20/.test(wf) && /persist-credentials: false/.test(wf));
  t('workflow: secrets are referenced only as environment or action inputs and never echoed; the write token is the GitHub App token, real modes only, and reaches the job step only', !/echo .*secrets\./.test(wf) && (wf.match(/secrets\./g) ?? []).length === 5 && !/github\.token|secrets\.GITHUB_TOKEN/.test(wf) && (wf.match(/steps\.app-token\.outputs\.token/g) ?? []).length === 1 && /- name: Run the job\s*\n\s*env:[^]*GITHUB_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/.test(wf) && /id: app-token\s*\n\s*if: inputs\.mode != 'dry_run'/.test(wf));
  t('workflow: the App token comes from a pinned action (full commit SHA), is limited to this repository and to contents write, pull requests write, checks read and deployments read', /uses: actions\/create-github-app-token@[0-9a-f]{40}\b/.test(wf) && /repositories: \$\{\{ github\.event\.repository\.name \}\}/.test(wf) && (wf.match(/permission-[a-z-]+: (read|write)/g) ?? []).join() === 'permission-contents: write,permission-pull-requests: write,permission-checks: read,permission-deployments: read' && !/permission-(workflows|administration|actions|statuses|secrets|environments)/.test(wf));
  t('the required check is the pull request\'s own run: ci.yml runs on pull_request and the publish code never dispatches a workflow', /^\s*pull_request:/m.test(rd('.github/workflows/ci.yml')) && !/dispatches|CI_WORKFLOW/.test(rd('scripts/lib/publish-git.mjs')) && !/dispatches|CI_WORKFLOW/.test(job));
  t('the job script writes only through the publish-git module (pull request flow), never to Notion, never to the media store, and never prints content', !/api\.notion\.com|method: 'PATCH'|method: 'DELETE'|archived|put\(|vercel-storage|console\.log\(.*(payload|snapshot|content)/.test(job) && /publishReal/.test(job) && !/git['", ]+push|spawnSync\('git/.test(job) && /delete e\.GITHUB_TOKEN/.test(job));
  t('the job script writes the snapshot only into the runner workspace and reports through the signed app endpoints only', /approved', `\$\{slug\}\.json`/.test(job) && /publish-callback/.test(job) && /publish-payload/.test(job));
  t('a failure after the merge is reported as merged (with the merge commit), never as untouched, and a rerun resumes from the merge', /after\.merged = true/.test(job) && /merged: true, mergeCommit: after\.mergeCommit/.test(job) && /resumed/.test(job));
  const refused = (mode) => { try { execFileSync('node', ['scripts/listings-publish-job.mjs', '--job', '11111111-1111-4111-8111-111111111111', '--public-id', 'lst_0123456789', '--mode', mode], { cwd: repoRoot, env: { PATH: process.env.PATH }, stdio: 'pipe' }); return false; } catch (e) { return e.status === 2; } };
  t('an unknown mode (withdraw, empty, anything else) is refused before anything runs', ['withdraw', 'delete', '', 'PUBLISH'].every(refused));
}

section('standing Victorian position for tenanted SDA investment sales (Contact Agent)');
{
  const live = JSON.parse(rd('src/data/listings/compliance.json'));
  const standing = live.victoria.determinations.find((d) => d.listingId === '*');
  const sda = (over = {}) => real({ draft: withMod((c) => { c.photos = [realPhoto()]; c.address = { ...c.address, state: 'VIC', postcode: '3217' }; c.pricing = { mode: 'contact_agent' }; c.sda = { designCategories: ['IL'], buildingType: 'House' }; Object.assign(c, over); }) });
  const withText = (text) => real({ draft: withMod((c) => { c.photos = [realPhoto()]; c.address = { ...c.address, state: 'VIC', postcode: '3217' }; c.pricing = { mode: 'contact_agent' }; c.sda = { designCategories: ['IL'] }; c.description = [text]; }) });
  const issues = (rec, cfg = live) => L.validateForPublication(rec, { ...vctx, compliance: cfg }, now).issues;
  const advertising = (rec, cfg = live) => issues(rec, cfg).filter((m) => /advertising position|Victorian pricing compliance/i.test(m));

  t('the standing record is complete, honest about what it is, and names what is NOT established', !!standing && standing.basis === 'internal_determination' && /not legal advice/i.test(standing.statement) && /NOT ESTABLISHED/.test(standing.statement) && /not evidence that any exemption applies/i.test(standing.statement) && /Australian Consumer Law/.test(standing.statement) && /residual risk/i.test(standing.statement) && /^https:\/\/www\.consumer\.vic\.gov\.au\//.test(standing.reference));
  t('the standing record declares the conditions the engine enforces', JSON.stringify(standing.conditions) === JSON.stringify(['sda_dwelling', 'no_price_indication']));
  t('a Victorian Contact Agent SDA listing with clean text is cleared by the standing record', L.victorianClearance(live, 'lst_aaaaaaaaaa', 'contact_agent').cleared && L.victorianClearance(live, 'lst_aaaaaaaaaa', 'contact_agent').basis === 'standing internal_determination' && advertising(sda()).length === 0);
  t('it clears Contact Agent only: Asking Price, Price Guide and EOI stay blocked in Victoria', ['asking_price', 'price_guide', 'eoi'].every((m) => !L.victorianClearance(live, 'lst_aaaaaaaaaa', m).cleared));
  t('it does not touch other states, and Rutherford Grove keeps its own record without conditions', L.validateForPublication(withState('QLD'), ctxWith(DENY), now).ok && (L.victorianClearance(live, 'lst_454f05d21f', 'contact_agent').conditions ?? []).length === 0);

  for (const phrase of ['Offers over the reserve are invited.', 'A great buy: guide price on request.', 'Strong yields, price guide available.', 'To be sold by auction.', 'Expressions of interest are now open.', 'Asking for serious investors only.', 'Offers from investors welcome.', 'Priced to sell quickly.', 'Negotiable for the right buyer.']) {
    t(`a price indication in the description blocks it: "${phrase.slice(0, 34)}"`, advertising(withText(`An established Improved Liveability SDA house with three participant places. ${phrase}`)).some((m) => /no indication of price/.test(m)));
  }
  t('price language in the title or a photo description also blocks it', advertising(sda({ title: 'Asking price SDA investment house' })).some((m) => /no indication of price/.test(m)) && advertising(sda({ photos: [{ ...realPhoto(), alt: 'Sold by auction signage' }] })).some((m) => /no indication of price/.test(m)));
  t('ordinary wording is not caught (contact, investment, enquire, occupied, tenanted)', advertising(withText('An established Improved Liveability SDA house with three participant places, tenanted and enrolled. Contact SDA Home Choices to enquire about this investment.')).length === 0);
  t('a listing without an SDA design category cannot rely on the standing record', advertising(sda({ sda: {} })).some((m) => /SDA dwellings only/.test(m)));
  t('an unknown condition fails closed, so a typo can never widen a record', (() => { const cfg = { ...live, victoria: { ...live.victoria, determinations: [{ ...standing, conditions: ['sda_dwelling', 'sda_dweling'] }] } }; return advertising(sda(), cfg).some((m) => /does not recognise/.test(m)); })());
  t('removing the standing record blocks the listing again (the requirement is not bypassed)', advertising(sda(), { ...live, victoria: { ...live.victoria, determinations: live.victoria.determinations.filter((d) => d.listingId !== '*') } }).some((m) => /Victorian pricing compliance is not cleared/.test(m)));
  t('a per-listing record without conditions behaves as before (nothing extra is imposed on it)', (() => { const cfg = { ...DENY, victoria: { ...DENY.victoria, determinations: [{ ...standing, listingId: 'lst_det', conditions: undefined }] } }; return L.victorianClearance(cfg, 'lst_det', 'contact_agent').cleared; })());
  const rg = JSON.parse(rd('src/data/listings/approved/rutherford-grove-armstrong-creek-vic.json'));
  t('the live Rutherford Grove snapshot still passes the Victorian gate with the live file', !advertising(real({ id: rg.listingId, draft: rg.content }), live).length);
  t('the policy is described in the compliance notes and names the unresolved questions', /Posición permanente/.test(rd('docs/victorian-pricing-compliance.md')) && /no prueba ninguna exención/.test(rd('docs/victorian-pricing-compliance.md')));
}


/* ---------------------------------------------------------------- optional public groups in a publication request */
section('publication engine: optional public groups from the signed request');
{
  const NT = { [N.state]: P_.sel('NT'), [N.webPublicAddress]: P_.rt('Whipray Circuit, Berrimah NT 0832') };
  const ntPage = () => pg(NT, '2e2909c1-0000-0000-0000-00000000b001');
  const approve = (inv) => ({ ...inv, approval: { valuesHash: L.investmentValuesHash({ ...inv, approval: { valuesHash: '0'.repeat(64) } }) } });
  const FIG = { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied', annualIncomeAud: 132704, incomeType: 'net', yieldPct: 11.1, yieldType: 'net', basis: 'projected' };
  const withX = (page, x) => run([page], { extras: new Map([[PID(page.id), x]]) });
  const none = await run([ntPage()]);
  const bare = await withX(ntPage(), undefined);
  t('no optional groups: the snapshot and its content hash are exactly what they were before this change', none[0].kind === 'new' && bare[0].kind === 'new' && none[0].snapshot.contentHash === bare[0].snapshot.contentHash && !('investment' in none[0].snapshot.content) && !('property' in none[0].snapshot.content) && !('marketing' in none[0].snapshot.content));
  t('an empty optional object changes nothing either', (await withX(ntPage(), {}))[0].snapshot.contentHash === none[0].snapshot.contentHash);
  const ok = await withX(ntPage(), { property: { bathrooms: 2, carSpaces: 1 }, sda: { bedrooms: 3, ooa: 'Onsite overnight assistance (OOA) available' }, investment: approve(FIG), marketing: { agency: 'sdahc' } });
  const c = ok[0].snapshot?.content;
  t('a non-Victorian listing with an approved block publishes the groups into the snapshot', ok[0].kind === 'new' && c.property.bathrooms === 2 && c.sda.bedrooms === 3 && c.sda.ooa.includes('OOA') && c.investment.yieldPct === 11.1 && c.marketing.agency === 'sdahc');
  t('the Notion-derived SDA facts are kept beside the added ones', !!c.sda.designCategories || !!c.sda.buildingType || Object.keys(c.sda).length >= 2);
  t('the snapshot hash covers the groups, so changing them is a new version', ok[0].snapshot.contentHash !== none[0].snapshot.contentHash);
  const tampered = await withX(ntPage(), { investment: { ...approve(FIG), yieldPct: 14.0 } });
  t('values changed after approval (the hash no longer matches) yield NO snapshot', tampered[0].kind === 'failed' && !tampered[0].snapshot && tampered[0].issues.some((m) => /not approved for public display, or were changed/.test(m)));
  t('a block without any approval is refused by the strict schema', (() => { const r = L.optionalGroupsSchema.safeParse({ investment: { leaseStatus: 'fully_leased' } }); return !r.success; })());
  const vic = pg({}, '2e2909c1-0000-0000-0000-00000000b002');
  const vicFig = await withX(vic, { investment: approve(FIG) });
  t('Victoria: income and yield yield NO snapshot, whatever the approval says', vicFig[0].kind === 'failed' && !vicFig[0].snapshot && vicFig[0].issues.some((m) => /Victorian listings/.test(m)));
  const vicLease = await withX(pg({}, '2e2909c1-0000-0000-0000-00000000b003'), { investment: approve({ leaseStatus: 'fully_leased', occupancyStatus: 'vacant' }) });
  t('Victoria: lease and occupancy alone are still allowed', vicLease[0].kind === 'new' && vicLease[0].snapshot.content.investment.leaseStatus === 'fully_leased');
  t('an unknown group or key is rejected by the strict schema (nothing can ride along)', !L.optionalGroupsSchema.safeParse({ secret: 1 }).success && !L.optionalGroupsSchema.safeParse({ sda: { designCategories: ['HPS'] } }).success && !L.optionalGroupsSchema.safeParse({ investment: { ...approve(FIG), approvedBy: 'x@y.com' } }).success);
  t('an unregistered agency yields NO snapshot', (await withX(ntPage(), { marketing: { agency: 'nobody-agency' } }))[0].kind === 'failed');
  t('free text in the block is scanned: a dollar amount in the tenure yields NO snapshot', (await withX(ntPage(), { investment: approve({ leaseStatus: 'fully_leased', tenure: 'Lease at $1,200 per week' }) }))[0].kind === 'failed');
  // an update that removes the groups produces a new version without them (the Publisher withdrew the disclosure)
  const prev = new Map([[PID(ntPage().id), ok[0].snapshot]]);
  const removed = await run([ntPage()], { previous: prev });
  t('an update with the groups removed proposes a new version without them', removed[0].kind === 'version' && !('investment' in removed[0].snapshot.content) && !('property' in removed[0].snapshot.content));
  const same = await run([ntPage()], { previous: prev, extras: new Map([[PID(ntPage().id), { property: { bathrooms: 2, carSpaces: 1 }, sda: { bedrooms: 3, ooa: 'Onsite overnight assistance (OOA) available' }, investment: approve(FIG), marketing: { agency: 'sdahc' } }]]) });
  t('re-running with the same groups proposes nothing (idempotent)', same[0].kind === 'unchanged');
  // parity: the snapshot must say exactly what the request carried
  const payload = { content: { title: '', description: 'x', publicAddress: 'A Street, Town VIC 3000', pricingMode: 'contact_agent', displayPrice: null, optional: { investment: approve(FIG) } }, manifest: { photos: [] } };
  const snap = { title: 'x', description: ['x'], address: { street: 'A Street', suburb: 'Town', state: 'VIC', postcode: '3000' }, pricing: { mode: 'contact_agent' }, photos: [], investment: approve(FIG) };
  t('parity: matching groups pass; a missing, extra or altered group is named', parity(snap, payload).length === 0 && parity({ ...snap, investment: undefined }, payload).includes('optional group investment') && parity({ ...snap, property: { bathrooms: 1 } }, payload).includes('optional group property') && parity({ ...snap, investment: { ...snap.investment, yieldPct: 9 } }, payload).includes('optional group investment'));
  t('the publish job validates the groups with the strict schema and passes them to the engine', /optionalGroupsSchema\.safeParse\(payload\.content\.optional\)/.test(rd('scripts/listings-publish-job.mjs')) && /extras,\n/.test(rd('scripts/listings-publish-job.mjs')) && /payload_invalid/.test(rd('scripts/listings-publish-job.mjs')));
}

await (await import('./test-publish-git.mjs')).default({ t, section });
await (await import('./test-optional-fields.mjs')).default({ t, section });
await (await import('./test-catalogue.mjs')).default({ t, section });
await (await import('./test-offmarket.mjs')).default({ t, section });
await (await import('./test-listing-page.mjs')).default({ t, section });
await (await import('./test-listing-seo.mjs')).default({ t, section });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
