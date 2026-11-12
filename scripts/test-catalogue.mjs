// Catalogue redesign: what a card may show (pure view model) and the page structure the brief fixes. Synthetic data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const NT = JSON.parse(rd('src/data/listings/approved/whipray-circuit-berrimah-nt.json'));
  const ap = (inv) => ({ ...inv, approval: { valuesHash: L.investmentValuesHash({ ...inv, approval: { valuesHash: '0'.repeat(64) } }) } });
  const FULL = { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied', annualIncomeAud: 450000, incomeType: 'net', yieldPct: 11.1, yieldType: 'net', basis: 'projected' };
  /** A public listing as the page receives it. */
  const pl = ({ state = 'NT', status = 'available', mod } = {}) => {
    const c = structuredClone(NT.content); c.address = { ...c.address, state }; if (mod) mod(c);
    return { ...c, id: 'lst_0000000001', summary: 'Summary text here.', commercialStatus: status, featured: false, version: 1, publishedAt: '2026-11-10', updatedAt: '2026-11-10', isDemo: false };
  };

  section('catalogue card: cover photograph');
  const plan = { ...NT.content.photos[2] };
  const front = NT.content.photos[0];
  t('the cover is the first photograph that is not a floorplan', L.coverPhoto([plan, front]).id === front.id && L.coverPhoto([front, plan]).id === front.id);
  t('a floorplan is never the cover, even when it is the only image (placeholder instead)', L.coverPhoto([plan]) === undefined && L.coverPhoto([]) === undefined);
  t('a demo photograph can be a cover (fixtures)', L.coverPhoto([{ demo: true, id: 'demo-a-one', accent: 'blue', alt: 'DEMO placeholder image 1 of 1.' }]) !== undefined);

  section('catalogue card: facts');
  t('only values that exist are listed, in a fixed order, nothing invented', JSON.stringify(L.cardFacts(pl())) === JSON.stringify([{ label: 'Design category', value: 'Robust' }]));
  t('a listing with no facts has an empty list (no placeholders)', L.cardFacts(pl({ mod: (c) => { c.sda = {}; } })).length === 0);
  const rich = L.cardFacts(pl({ mod: (c) => { c.sda = { designCategories: ['IL'], buildingType: 'House', bedrooms: 3, residentPlaces: 3 }; c.property = { bathrooms: 2, carSpaces: 2 }; } }));
  t('physical and SDA facts appear with their labels, capped at five', rich.length === 5 && rich[0].value === 'Improved Liveability' && rich.some((f) => f.label === 'Bedrooms' && f.value === '3') && rich.some((f) => f.label === 'Car spaces'));
  t('zero car spaces is a real value and is shown', L.cardFacts(pl({ mod: (c) => { c.property = { carSpaces: 0 }; } })).some((f) => f.label === 'Car spaces' && f.value === '0'));

  section('catalogue card: commercial column');
  const comm = (o) => L.cardCommercial(pl(o));
  t('no commercial data means no commercial column at all', comm() === null);
  t('an approved yield shows with its type and basis; lease and occupancy are separate lines', (() => { const c = comm({ mod: (x) => { x.investment = ap(FULL); } }); return c.yield.text === '11.1%' && c.yield.label === 'Net yield' && c.yield.basis === 'Projected' && c.lease === 'Fully leased' && c.occupancy === 'Partially occupied'; })());
  t('tenancy without occupancy shows only the lease line', (() => { const c = comm({ mod: (x) => { x.investment = ap({ leaseStatus: 'fully_leased' }); } }); return c.lease === 'Fully leased' && !('occupancy' in c) && !('yield' in c); })());
  t('occupancy without a lease shows only the occupancy line', (() => { const c = comm({ mod: (x) => { x.investment = ap({ occupancyStatus: 'vacant' }); } }); return c.occupancy === 'Vacant' && !('lease' in c); })());
  t('unapproved or altered figures show nothing', comm({ mod: (x) => { x.investment = { ...ap(FULL), yieldPct: 15 }; } }) === null);
  t('Victoria: no yield on the card, lease and occupancy still allowed', (() => { const c = comm({ state: 'VIC', mod: (x) => { x.investment = ap(FULL); } }); return !('yield' in c) && c.lease === 'Fully leased'; })());
  t('Victoria with only income and yield figures shows no column', comm({ state: 'VIC', mod: (x) => { x.investment = ap({ annualIncomeAud: 1000, incomeType: 'gross', yieldPct: 7, yieldType: 'gross', basis: 'actual' }); } }) === null);
  t('Sold shows no commercial column', comm({ status: 'sold', mod: (x) => { x.investment = ap(FULL); } }) === null);
  t('an approved price is shown as approved on an Available card, never on a Sold card, and Contact Agent shows none', L.cardCommercial(pl({ mod: (c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; } })).price.value === '$695,000' && L.cardCommercial(pl({ status: 'sold', mod: (c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; } })) === null && L.cardCommercial(pl()) === null);
  t('the card never carries income or the approval hash', !/450000|valuesHash|approval/.test(JSON.stringify(L.cardView(pl({ mod: (x) => { x.investment = ap(FULL); } })).commercial)));

  section('catalogue card: agency and actions');
  const v = L.cardView(pl());
  t('the default agency is SDA Home Choices and its logo file is the existing brand asset', v.agency.name === 'SDA Home Choices' && v.agency.logoOnDark === 'logo-white.png');
  t('Sold flips the primary action to similar properties', L.cardView(pl({ status: 'sold' })).sold === true && L.cardView(pl()).sold === false);
  const card = rd('src/components/ListingCard.astro');
  t('Contact Agent goes to that listing\'s enquiry form, View details to the listing, Sold to the contact page', /href=\{`\$\{href\}#enquire`\}>Contact Agent/.test(card) && /href=\{href\}>View details/.test(card) && /href="\/contact-us\/">Find similar properties/.test(card));
  t('the logo is in the commercial column when there is one, otherwise at the right of the footer', /\{commercial && \([\s\S]*lc-comm[\s\S]*<Image class="lc-logo"/.test(card) && /\{!commercial && logo && <Image class="lc-logo lc-logo--foot"/.test(card) && /\.lc-logo--foot\{margin-left:auto/.test(card));
  t('photographs are cropped to a 4:3 frame, never stretched', /\.lc-media\{[^}]*aspect-ratio:4\/3/.test(card) && /\.lc-logo\{[^}]*object-fit:contain/.test(card));
  t('the card keeps the data attributes the filter script reads', ['data-state', 'data-type', 'data-status', 'data-design', 'data-search', 'data-suburb', 'data-index'].every((a) => card.includes(a)));

  section('catalogue page structure');
  const page = rd('src/pages/opportunities.astro'); const cat = rd('src/components/ListingsCatalogue.astro'); const hero = rd('src/components/OpportunitiesHero.astro');
  t('the title and subtitle are kept', /SDA Investment<\/span> <span class="oh-l2">Opportunities/.test(hero) && /Explore available SDA properties and discover exclusive off-market investment opportunities/.test(hero));
  t('the catalogue heading and its paragraph are removed', !/Available SDA Properties/.test(cat) && !/SDA properties we can show publicly/.test(cat));
  t('the "Listed publicly" card is gone and the hero holds no path cards or fan', !/>Listed publicly</i.test(hero + page + cat) && !/oh-k/.test(hero) && !/HeroCardFan|oh-path/.test(hero));
  t('order on the page: hero, catalogue (filters and cards), then the fan band, then Why off-market', (() => { const i = (s) => page.indexOf(s); return i('<OpportunitiesHero') < i('<ListingsCatalogue') && i('<ListingsCatalogue') < i('<HeroCardFan') && i('<HeroCardFan') < i('Why off-market'); })());
  t('Confidential Access sits beside the results (desktop grid) and after them in the page (mobile)', /lcat-layout\{[^}]*grid-template-columns:minmax\(0,1fr\) 320px/.test(cat) && cat.indexOf('lcat-results') < cat.indexOf('lcat-side') && /max-width:1100px\)\{\.lcat-layout\{grid-template-columns:1fr/.test(cat));
  t('the static Why off-market content and the access steps are kept', /Why off-market/.test(page) && /How access works/.test(page) && /A curated, confidential market/.test(page));
  t('the existing filters are kept and sit before the results', ['f-q', 'f-state', 'f-design', 'f-type', 'f-status', 'f-sort'].every((id) => cat.includes(`id="${id}"`)) && cat.indexOf('data-lcat-filters') < cat.indexOf('lcat-layout'));
  t('the page keeps its #listings and #access anchors', /id="listings"/.test(cat) && /id="access"/.test(page));
}
