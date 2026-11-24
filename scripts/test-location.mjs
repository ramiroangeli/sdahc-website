// The public LOCATION of an individual listing: "Greater Darwin", "Berrimah NT" and the street form published so far. Synthetic data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';
import { parity } from './lib/publish-job.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const NT = JSON.parse(rd('scripts/fixtures/base-whipray.json'));
  const N = L.NOTION;
  const refuses = (text, state = 'NT') => { try { L.resolvePublicLocation(text, state); return false; } catch (e) { return e instanceof L.LocationError || e instanceof L.AddressError; } };

  section('public location: what is accepted and what is refused');
  const gd = L.resolvePublicLocation('Greater Darwin', 'NT');
  t('"Greater Darwin" is a valid public location for an NT property: label as typed, state from the CRM, no address', gd.location?.label === 'Greater Darwin' && gd.location.state === 'NT' && !gd.address);
  const bn = L.resolvePublicLocation('Berrimah NT', 'NT');
  t('"Berrimah NT" is accepted; a postcode at the end is dropped, never stored', bn.location?.label === 'Berrimah NT' && L.resolvePublicLocation('Berrimah NT 0832', 'NT').location.label === 'Berrimah NT');
  t('the street form published so far is unchanged (same parse, same address object)', JSON.stringify(L.resolvePublicLocation('Whipray Circuit, Berrimah NT 0832', 'NT').address) === JSON.stringify(NT.content.address));
  t('a house, unit or lot number is refused, never cleaned', ['21 Whipray Circuit, Berrimah NT 0832', '3/45 Foo Street, Bar NT 0800', 'Berrimah 21', 'Unit 5 Berrimah', 'Lot 12 Berrimah', 'Level 3 Darwin', '12a Smith Street'].every((x) => refuses(x)));
  t('links, emails, slashes and phone numbers are refused', ['https://x.example', 'Darwin a@b.com', 'Darwin/Palmerston', 'Call 0408 550 441'].every((x) => refuses(x)));
  t('the state is NOT read from the text: a contradiction with the CRM is refused, a broad region that does not match the suburb is fine', refuses('Berrimah VIC', 'NT') && !refuses('Greater Darwin', 'NT') && !refuses('Top End', 'NT'));
  t('a location needs a CRM state (or names one); with neither it is refused with a plain reason', refuses('Greater Darwin', null) && L.resolvePublicLocation('Darwin NT', null).location.state === 'NT');
  t('an empty location is refused with the help the team needs', (() => { try { L.resolvePublicLocation('', 'NT'); return false; } catch (e) { return /Greater Darwin/.test(e.message) && /stays private/.test(e.message); } })());
  t('nothing claims an official area: the contract has only label and state', Object.keys(L.publicLocationSchema.shape).sort().join() === 'label,state' && !L.publicLocationSchema.safeParse({ label: 'Greater Darwin', state: 'NT', sa4: 'x' }).success);

  section('public location: the contract');
  const base = structuredClone(NT.content); delete base.address;
  const withLoc = { ...base, location: { label: 'Greater Darwin', state: 'NT' } };
  t('an individual listing may carry a location instead of an address', L.publicContentSchema.safeParse(withLoc).success);
  t('it carries one or the other, never both, never neither; a label has no digits', !L.publicContentSchema.safeParse({ ...withLoc, address: NT.content.address }).success && !L.publicContentSchema.safeParse(base).success && !L.publicLocationSchema.safeParse({ label: '21 Whipray', state: 'NT' }).success);
  t('every real approved listing still parses unchanged (existing publications are compatible)', ['rutherford-grove-armstrong-creek-vic', 'sheppard-street-shepparton-vic', 'whipray-circuit-berrimah-nt'].every((s) => L.publicContentSchema.safeParse(JSON.parse(rd(`src/data/listings/approved/${s}.json`)).content).success));
  t('the state appears once in a location slug, whether or not the label already ends with it', L.makeLocationSlug({ label: 'Greater Darwin NT', state: 'NT' }, new Set(), 's') === 'greater-darwin-nt' && L.makeLocationSlug({ label: 'Greater Darwin', state: 'NT' }, new Set(), 's') === 'greater-darwin-nt' && L.makeLocationSlug({ label: 'Berrimah', state: 'NT' }, new Set(), 's') === 'berrimah-nt');
  t('a location slug is letters and hyphens, stable and unique', L.makeLocationSlug(gd.location, new Set(), 'lst_a') === 'greater-darwin-nt' && L.makeLocationSlug(gd.location, new Set(['greater-darwin-nt']), 'lst_a') !== 'greater-darwin-nt' && /^[a-z]+(-[a-z]+)*$/.test(L.makeLocationSlug(gd.location, new Set(['greater-darwin-nt']), 'lst_a')));

  section('public location: the engine reads it from the CRM row');
  const rt = (x) => ({ type: 'rich_text', rich_text: [{ plain_text: x }] }); const sel = (x) => ({ type: 'select', select: { name: x } });
  const page = (place, state = 'NT') => ({ id: '2e2909c1-0000-0000-0000-00000000c001', last_edited_time: '2026-11-19T00:00:00.000Z', properties: { [N.name]: { type: 'title', title: [{ plain_text: '31 Whipray Circuit, Berrimah NT 0832' }] }, [N.state]: sel(state), [N.webStatus]: sel('Published'), [N.webPublicAddress]: rt(place), [N.webDescription]: rt('A home in the Top End.'), [N.webPricingMode]: sel('Contact Agent') } });
  const rec = L.pageToRecord(page('Greater Darwin'), { photos: [] });
  t('"Greater Darwin" builds a draft with a location, the CRM state and a default title from the label', !!rec.record.draft && rec.record.draft.location?.label === 'Greater Darwin' && rec.record.draft.location.state === 'NT' && !rec.record.draft.address && rec.record.draft.title === 'SDA property, Greater Darwin' && rec.record.draft.slug === 'greater-darwin-nt', JSON.stringify(rec.issues));
  t('a street address still builds an address draft; a number is still refused', !!L.pageToRecord(page('Whipray Circuit, Berrimah NT 0832'), { photos: [] }).record.draft?.address && L.pageToRecord(page('21 Whipray Circuit, Berrimah NT 0832'), { photos: [] }).record.draft === null);
  t('a location that contradicts the CRM state is refused by the engine', L.pageToRecord(page('Berrimah VIC'), { photos: [] }).record.draft === null);

  section('public location: card, page, search engines, commercial rules');
  const pl = { ...withLoc, id: 'lst_b1b2b3b4b5', summary: 'A home in the Top End.', commercialStatus: 'available', featured: false, version: 1, publishedAt: 'x', updatedAt: 'x', isDemo: false, title: 'Four bedroom SDA home' };
  t('the public listing parses with the strict schema', L.publicListingSchema.safeParse(pl).success);
  t('the card and page show the location label when the title does not', L.cardView(pl).location === 'Greater Darwin' && L.detailLocation(pl) === 'Greater Darwin' && L.cardLocation({ ...pl, title: 'Greater Darwin SDA' }) === undefined);
  t('the title and meta description name the place with its state; structured data has no street', /for sale in Greater Darwin, NT/.test(L.listingSeoTitle(pl)) && /in Greater Darwin, NT/.test(L.listingSeoDescription(pl)) && !/streetAddress/.test(JSON.stringify(L.listingNode(pl, 'https://sdahomechoices.com.au'))));
  t('states, filters and related listings use the CRM state of a location', L.listingStates(pl).join() === 'NT' && L.relatedListings({ ...pl, id: 'lst_x', slug: 'other-nt' }, [pl, { ...pl, id: 'lst_y', slug: 'y-nt', location: { label: 'Alice Springs', state: 'NT' } }, { ...pl, id: 'lst_z', slug: 'z-vic', location: { label: 'Geelong', state: 'VIC' }, sda: {} }]).every((x) => x.id !== 'lst_x'));
  t('Victorian rules follow the structured state: income and yield on a Victorian location need the authorisation flag', (() => {
    const inv = { annualIncomeAud: 100000, incomeType: 'gross', yieldPct: 7, yieldType: 'net', basis: 'actual', approval: { valuesHash: '0'.repeat(64) } };
    const ok = { ...inv, approval: { valuesHash: L.investmentValuesHash(inv) } };
    const vic = { ...pl, location: { label: 'Greater Melbourne', state: 'VIC' }, investment: ok };
    const issues = L.checkPublicSafety({ ...withLoc, location: vic.location, investment: ok }, { allowDemo: true, compliance: { victoria: { cleared: {} }, basicClassification: { confirmedListingIds: [] } } });
    const view = L.publicInvestment(vic); return (!view || !view.yield) && issues.some((i) => /Victorian|Income and yield/.test(i));
  })());
  t('private data is still scanned in a location (email, phone, house number)', L.checkPublicSafety({ ...withLoc, location: { label: 'Darwin', state: 'NT' }, description: ['Call 0408 550 441'] }, { allowDemo: true }).length > 0);
  t('the publish job compares the location by its label, never by an address', parity(withLoc, { content: { title: withLoc.title, description: withLoc.description.join('\n\n'), publicAddress: 'Greater Darwin', pricingMode: withLoc.pricing.mode, displayPrice: null } }, withLoc.photos).filter((p) => /address|location/.test(p)).length === 0
    && parity(withLoc, { content: { title: withLoc.title, description: withLoc.description.join('\n\n'), publicAddress: 'Alice Springs', pricingMode: withLoc.pricing.mode, displayPrice: null } }, withLoc.photos).includes('location'));
}
