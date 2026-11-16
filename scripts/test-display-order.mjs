// The default order of the public catalogue: featured first, then SDA Home Choices' saved order. Synthetic listings only: no real listing is read.
// Called from scripts/test-listings.mjs with its t() and section() helpers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const id = (n) => `lst_${String(n).padStart(10, '0')}`;
  // a synthetic public listing: only the fields the ordering reads
  const mk = (n, { featured = false, day = n, title = `Property ${n}` } = {}) => ({ id: id(n), title, featured, publishedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z` });
  const ids = (list) => list.map((l) => Number(l.id.slice(-10)));
  const A = mk(1); const B = mk(2); const C = mk(3); const D = mk(4);   // published 1st, 2nd, 3rd, 4th: D is the newest

  section('display order: no featured listing');
  t('with no saved order the default stays newest first (the behaviour before this feature)', ids(L.orderListings([A, B, C, D])).join() === '4,3,2,1');
  t('the input order does not matter, and the input list is not changed', (() => { const input = [C, A, D, B]; const out = L.orderListings(input); return ids(out).join() === '4,3,2,1' && ids(input).join() === '3,1,4,2'; })());
  t('an empty or missing saved order is the same as none', ids(L.orderListings([A, B, C], [])).join() === '3,2,1' && ids(L.orderListings([A, B, C], undefined)).join() === '3,2,1');
  t('two listings published at the same moment fall back to title, then id, so the order is always the same', ids(L.orderListings([mk(6, { day: 5, title: 'Beta' }), mk(5, { day: 5, title: 'Alpha' })])).join() === '5,6');

  section('display order: one featured listing');
  t('a featured listing is first even though it is the oldest', ids(L.orderListings([A, B, C, D].map((l) => (l.id === id(1) ? { ...l, featured: true } : l)))).join() === '1,4,3,2');
  t('a featured listing is first even when the saved order puts it last', ids(L.orderListings([A, B, C].map((l) => (l.id === id(1) ? { ...l, featured: true } : l)), [id(3), id(2), id(1)])).join() === '1,3,2');
  t('it is first in every input order (the Armstrong Creek case: featured, older than the listing before it)', [[A, B], [B, A]].every((p) => ids(L.orderListings(p.map((l) => (l.id === id(1) ? { ...l, featured: true } : l)))).join() === '1,2'));
  t('un-featuring it returns it to its place in the saved order', ids(L.orderListings([A, B, C], [id(1), id(2), id(3)])).join() === '1,2,3');

  section('display order: several historically featured listings');
  const F = [mk(1, { featured: true }), mk(2), mk(3, { featured: true }), mk(4)];
  t('every featured listing precedes every other listing', ids(L.orderListings(F)).join() === '3,1,4,2');
  t('inside the featured group the saved order applies', ids(L.orderListings(F, [id(1), id(3)])).join() === '1,3,4,2');
  t('inside the featured group a placed listing comes before an unplaced one', ids(L.orderListings(F, [id(1)])).join() === '1,3,4,2');
  t('only one listing is ever first: the order is a strict total order (no ties, same result for every input permutation)', (() => {
    const perms = [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]].map((p) => ids(L.orderListings(p.map((i) => F[i]), [id(3), id(1), id(2), id(4)])).join());
    return new Set(perms).size === 1 && perms[0] === '3,1,2,4';
  })());

  section('display order: manual order of three or more properties');
  const five = [mk(1), mk(2), mk(3), mk(4), mk(5)];
  t('the saved order is followed exactly', ids(L.orderListings(five, [id(2), id(5), id(1), id(4), id(3)])).join() === '2,5,1,4,3');
  t('a listing placed first is first; moved down it follows the one before it', ids(L.orderListings(five, [id(1), id(5), id(2), id(3), id(4)])).join() === '1,5,2,3,4');
  t('the same saved order gives the same result however the site loads the listings', ids(L.orderListings([...five].reverse(), [id(4), id(2), id(1), id(5), id(3)])).join() === ids(L.orderListings(five, [id(4), id(2), id(1), id(5), id(3)])).join());

  section('display order: adding a new listing');
  t('a listing published after the order was saved is not in it: it appears after the placed listings, and below any featured listing', ids(L.orderListings([mk(1), mk(2), mk(3), mk(9)], [id(2), id(3), id(1)])).join() === '2,3,1,9');
  t('several unplaced listings come last, newest first, and the placed ones keep their order', ids(L.orderListings([mk(1), mk(2), mk(3), mk(8), mk(9)], [id(3), id(1)])).join() === '3,1,9,8,2');
  t('the full precedence: featured placed, featured unplaced, other placed, other unplaced (newest first)', ids(L.orderListings([mk(1, { featured: true }), mk(9, { featured: true }), mk(2, { featured: true }), mk(3), mk(4), mk(5), mk(6)], [id(2), id(1), id(4), id(3)])).join() === '2,1,9,4,3,6,5');

  section('display order: removing or withdrawing a listing');
  t('an id in the saved order that is no longer public is ignored and the others keep their order', ids(L.orderListings([mk(1), mk(3)], [id(3), id(2), id(1)])).join() === '3,1');
  t('a withdrawn listing is not in the public list at all, with or without a place in the saved order', (() => {
    const base = { records: L.FIXTURE_RECORDS, snapshots: L.FIXTURE_SNAPSHOTS, now: new Date('2026-11-20T00:00:00Z'), ctx: { allowDemo: true } };
    const all = L.buildPublicListings({ ...base, order: ['fx_003', 'fx_002', 'fx_001'] });
    const wd = L.buildPublicListings({ ...base, order: ['fx_003', 'fx_002', 'fx_001'], withdrawn: new Set(['fx_003']) });
    return all.length === 3 && wd.length === 2 && wd.every((l) => l.id !== 'fx_003');
  })());

  section('display order: the saved file');
  t('the committed file is valid and, as shipped, empty: nothing is reordered until staff save an order', (() => { const d = L.parseDisplayOrder(JSON.parse(rd('src/data/listings/display-order.json'))); return d.version === 1 && Array.isArray(d.order); })());
  const bad = (x) => { try { L.parseDisplayOrder(x); return false; } catch { return true; } };
  t('it accepts public listing ids only: no slug, no address, no extra field, no duplicate, no other version', bad({ version: 1, order: ['rutherford-grove'] }) && bad({ version: 1, order: [id(1), id(1)] }) && bad({ version: 1, order: [id(1)], note: 'x' }) && bad({ version: 2, order: [] }) && bad({ order: [] }) && !bad({ version: 1, order: [id(1), id(2)] }));
  t('the site loads it with the strict schema, so a malformed file fails the build instead of publishing in the wrong order', /parseDisplayOrder\(displayOrderFile\)\.order/.test(rd('src/data/listings/index.ts')));

  section('display order: public content is never changed by ordering');
  t('the same listings come out with and without a saved order: only their position differs', (() => {
    const base = { records: L.FIXTURE_RECORDS, snapshots: L.FIXTURE_SNAPSHOTS, now: new Date('2026-11-20T00:00:00Z'), ctx: { allowDemo: true } };
    const key = (l) => l.id;
    const plain = L.buildPublicListings(base).sort((a, b) => key(a).localeCompare(key(b)));
    const ordered = L.buildPublicListings({ ...base, order: ['fx_003', 'fx_002', 'fx_001'] }).sort((a, b) => key(a).localeCompare(key(b)));
    return plain.length === 3 && JSON.stringify(plain) === JSON.stringify(ordered);
  })());
  t('the order file cannot carry content: the only field is a list of ids', JSON.stringify(Object.keys(L.displayOrderSchema.shape)) === '["version","order"]');

  section('display order: visitor sorting and filtering');
  const cat = rd('src/components/ListingsCatalogue.astro');
  t('the default Sort by is Recommended and it is the first option, so the page loads in the saved order and Clear restores it', /<option value="recommended">Recommended<\/option>\s*<option value="newest">Newest first<\/option>\s*<option value="suburb">Suburb A to Z<\/option>\s*<option value="status">Availability<\/option>/.test(cat));
  t('the existing options keep working: Newest first now sorts by publication date, Suburb and Availability are unchanged', /if \(by === 'newest'\) return \(b\.dataset\.published/.test(cat) && /if \(by === 'suburb'\)/.test(cat) && /if \(by === 'status'\)/.test(cat));
  t('Recommended is the order of the HTML, which is the saved order, and is also the tie-break for Availability', /return Number\(a\.dataset\.index\) - Number\(b\.dataset\.index\);\s*\};/.test(cat) && /rank\[a\.dataset\.status \?\? ''\] \?\? 9\) - \(rank\[b\.dataset\.status \?\? ''\] \?\? 9\) \|\| Number\(a\.dataset\.index\)/.test(cat));
  t('filters run on the cards, then the chosen sort orders the matches: a filter never rewrites the saved order', /const matched = cards\.filter/.test(cat) && /matched\.sort\(sorter\)/.test(cat) && !/data-index.*=/.test(cat.replace(/dataset\.index/g, '')));
  t('a shared link only carries a sort that is not the default, so the default is clean and reload restores it', /!\(k === 'sort' && v === 'recommended'\)/.test(cat));
  t('the cards are rendered in the saved order, with their position as data-index', /listings\.map\(\(l, i\) => <ListingCard listing=\{l\} index=\{i\}/.test(cat) && /data-index=\{index\}/.test(rd('src/components/ListingCard.astro')));
  t('one ordering rule serves every page: the catalogue, the homepage cards, related properties and the sitemap all read getPublicListings()', /orderListings\(out, order\)/.test(rd('src/data/listings/publish.ts')) && [rd('src/components/HeroCardFan.astro'), rd('src/pages/opportunities.astro')].every((s) => /getPublicListings|listings/.test(s)));

  section('display order: visibility rules and off-market are untouched');
  t('ordering runs after visibility: Sold and Withdrawn rules are decided before it and it cannot make a hidden listing visible', (() => { const s = rd('src/data/listings/publish.ts'); return s.indexOf('if (!res.visible') > -1 && s.indexOf('if (!res.visible') < s.indexOf('orderListings(out, order)'); })());
  t('the order feature reads no off-market data', !/off-market|offMarket|opportunities-enquir/i.test(rd('src/data/listings/ordering.ts')));
}
