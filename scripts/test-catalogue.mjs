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

  section('catalogue card: heading, location and compact facts');
  t('the heading is the approved public title and the location line is dropped when the title already says where it is', L.cardLocation(pl()) === undefined);
  t('a title that does not name the suburb gets the public location underneath (suburb, state, postcode only)', L.cardLocation(pl({ mod: (c) => { c.title = 'Established SDA house'; } })) === 'Berrimah NT 0832');
  t('the location line never carries the street or a number', !/\d{1,3}\s|Whipray/.test(L.cardLocation(pl({ mod: (c) => { c.title = 'Established SDA house'; } }))));
  t('design category is stated in words, separately from the compact facts', L.cardFacts(pl()).design === 'Robust' && L.cardFacts(pl()).parts.length === 0);
  t('a listing with no facts has no design and no parts (nothing invented, no empty labels)', (() => { const f = L.cardFacts(pl({ mod: (c) => { c.sda = {}; } })); return f.design === undefined && f.parts.length === 0; })());
  const rich = L.cardFacts(pl({ mod: (c) => { c.sda = { designCategories: ['IL'], buildingType: 'House', bedrooms: 3, residentPlaces: 3 }; c.property = { bathrooms: 2, carSpaces: 2 }; } }));
  t('facts read House, 3 bed, 2 bath, 2 car, 3 participant places in that order', rich.design === 'Improved Liveability' && rich.parts.join(' | ') === 'House | 3 bed | 2 bath | 2 car | 3 participant places');
  t('missing values are omitted, not shown empty', L.cardFacts(pl({ mod: (c) => { c.sda = { buildingType: 'House', bedrooms: 3 }; } })).parts.join(' | ') === 'House | 3 bed');
  t('zero car spaces is a real value and is shown', L.cardFacts(pl({ mod: (c) => { c.property = { carSpaces: 0 }; } })).parts.includes('0 car'));

  section('catalogue card: commercial column');
  const comm = (o) => L.cardCommercial(pl(o));
  t('no commercial data means no commercial column at all', comm() === null);
  t('an approved yield shows with its type and basis; lease and occupancy are separate lines', (() => { const c = comm({ mod: (x) => { x.investment = ap(FULL); } }); return c.yield.text === '11.1%' && c.yield.label === 'Net yield' && c.yield.basis === 'Projected' && c.lease.value === 'Fully leased' && c.occupancy.value === 'Partially occupied' && c.occupancy.label === 'Occupancy'; })());
  t('tenancy without occupancy shows only the lease line', (() => { const c = comm({ mod: (x) => { x.investment = ap({ leaseStatus: 'fully_leased' }); } }); return c.lease.value === 'Fully leased' && c.lease.label === 'Lease' && !('occupancy' in c) && !('yield' in c); })());
  t('occupancy without a lease shows only the occupancy line', (() => { const c = comm({ mod: (x) => { x.investment = ap({ occupancyStatus: 'vacant' }); } }); return c.occupancy.value === 'Vacant' && c.occupancy.label === 'Occupancy' && !('lease' in c); })());
  t('unapproved or altered figures show nothing', comm({ mod: (x) => { x.investment = { ...ap(FULL), yieldPct: 15 }; } }) === null);
  t('Victoria: no yield on the card, lease and occupancy still allowed', (() => { const c = comm({ state: 'VIC', mod: (x) => { x.investment = ap(FULL); } }); return !('yield' in c) && c.lease.value === 'Fully leased'; })());
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
  t('every card has the same photograph column; a commercial column adds no photo width change', /\.lc-main\{flex:1 0 auto;--ph:310px;--cc:200px;display:grid;grid-template-columns:var\(--ph\) minmax\(0,1fr\)/.test(card) && /\.lc-main--comm\{grid-template-columns:var\(--ph\) minmax\(0,1fr\) var\(--cc\)\}/.test(card));
  t('the catalogue card has no description and the title is the approved title, two lines at most', !/listing\.summary|lc-sum/.test(card) && /\{listing\.title\}<\/a>/.test(card) && /-webkit-line-clamp:2/.test(card));
  t('lease and occupancy render as separate labelled indicators', /lc-ind-k">\{i\.label\}/.test(card) && /lc-ind-v">\{i\.value\}/.test(card));
  t('the logo is 44 to 48px tall and never wraps to its own row on a phone', /height=\{44\}/.test(card) && /height=\{48\}/.test(card) && !/lc-logo--foot\{[^}]*flex:0 0 100%/.test(card));
  t('photographs are cropped to a 4:3 frame, never stretched', /\.lc-media\{[^}]*aspect-ratio:4\/3/.test(card) && /\.lc-logo\{[^}]*object-fit:contain/.test(card));
  t('the card keeps the data attributes the filter script reads', ['data-state', 'data-type', 'data-status', 'data-design', 'data-search', 'data-suburb', 'data-index'].every((a) => card.includes(a)));

  section('catalogue page structure');
  const page = rd('src/pages/opportunities.astro'); const cat = rd('src/components/ListingsCatalogue.astro'); const hero = rd('src/components/OpportunitiesHero.astro');
  t('the title and subtitle are kept', /SDA Investment<\/span> <span class="oh-l2">Opportunities/.test(hero) && /Explore available SDA properties and discover exclusive off-market investment opportunities/.test(hero));
  t('the catalogue heading and its paragraph are removed', !/Available SDA Properties/.test(cat) && !/SDA properties we can show publicly/.test(cat));
  t('the "Listed publicly" card is gone and the hero holds no path cards or fan', !/>Listed publicly</i.test(hero + page + cat) && !/oh-k/.test(hero) && !/HeroCardFan|oh-path/.test(hero));
  t('order on the page: hero, catalogue (filters and cards), then the fan band, then Why off-market', (() => { const i = (s) => page.indexOf(s); return i('<OpportunitiesHero') < i('<ListingsCatalogue') && i('<ListingsCatalogue') < i('<HeroCardFan') && i('<HeroCardFan') < i('Why off-market'); })());
  t('one grid: the first visible card and the Confidential Access panel share the first row; later cards span the full width; the panel is not sticky', /\.lcat-grid\{[^}]*grid-template-columns:minmax\(0,1fr\) 280px/.test(cat) && /\.lcat-grid>:global\(\.lc\)\{grid-column:1 \/ -1\}/.test(cat) && /\.lc\.lc--first\)\{grid-column:1;align-self:stretch\}/.test(cat) && /\.lcat-panel\{grid-column:2;grid-row:1/.test(cat) && !/position:\s*sticky/.test(cat));
  t('the first card is chosen by the active sort and filters (class set by the script), not hardcoded', /card\.classList\.toggle\('lc--first', card === shown\[0\]\)/.test(cat) && /first=\{i === 0\}/.test(cat));
  t('on tablet and mobile the grid is one column and the panel follows the results (it is last in the page order)', /max-width:1100px\)\{[\s\S]*?\.lcat-grid\{grid-template-columns:minmax\(0,1fr\)\}/.test(cat) && cat.indexOf('data-lcat-loadmore') < cat.indexOf('class="lcat-panel"'));
  section('catalogue pagination');
  t('ten properties show first, in both the page and the script, and Load more adds ten', /const PAGE = 10;/.test(cat) && (cat.match(/const PAGE = 10;/g) || []).length === 2 && /limit \+= PAGE/.test(cat) && />Load more properties<\/button>/.test(cat));
  t('every listing is in the HTML with its link (crawlable); cards beyond the first ten are only hidden, not omitted', /listings\.map\(\(l, i\) => <ListingCard listing=\{l\} index=\{i\} first=\{i === 0\} beyondFirstPage=\{i >= PAGE\} \/>\)/.test(cat) && /hidden=\{beyondFirstPage\}/.test(card) && /href=\{href\} title=\{listing\.title\}/.test(card));
  t('without JavaScript every property shows and the Load more row is removed', /<noscript><style>\.lc\[hidden\]\{display:block!important\}\.lcat-loadmore\{display:none!important\}<\/style><\/noscript>/.test(cat));
  t('filtering and sorting run across the whole inventory first, then the first ten matches are shown', /const matched = cards\.filter\(/.test(cat) && /matched\.slice\(0, limit\)/.test(cat));
  t('a changed filter, sort or Clear starts again from ten; Load more does not reset', /const restart = \(\) => \{ limit = PAGE; apply\(\); \}/.test(cat) && /addEventListener\('input', restart\)/.test(cat) && /addEventListener\('change', restart\)/.test(cat) && /setTimeout\(restart, 0\)/.test(cat));
  t('the count is accurate and says "matching" when a filter is active; the button disappears when everything is shown', /Showing \$\{shown\.length\} of \$\{matched\.length\} \$\{filtered \? 'matching ' : ''\}properties/.test(cat) && /loadItem\.hidden = shown\.length >= matched\.length/.test(cat));
  t('focus moves to the first newly shown property after Load more', /matched\[before\]\?\.querySelector<HTMLAnchorElement>\('a\.lc-link'\)\?\.focus\(\)/.test(cat));
  t('images beyond the first page are not fetched until shown (lazy images inside hidden cards)', /loading=\{loading\}/.test(rd('src/components/ListingImage.astro')) && /loading = 'lazy'/.test(rd('src/components/ListingImage.astro')));
  section('catalogue wide cards');
  t('cards that span the full width keep the same photograph size and redistribute the extra width', /@container \(min-width: 960px\)/.test(card) && /\.lc-main--comm\{grid-template-columns:var\(--ph\) minmax\(0,1fr\) 300px\}/.test(card) && !/@container[^}]*--ph:/.test(card));
  t('indicators sit side by side in a wide commercial column; narrow layouts stay stacked', /\.lc-inds\{flex-direction:row;flex-wrap:wrap\}/.test(card));
  t('the static Why off-market content and the access steps are kept', /Why off-market/.test(page) && /How access works/.test(page) && /A curated, confidential market/.test(page));
  t('on a phone the secondary filters sit behind a labelled Filters disclosure, the search stays visible, and the selections and Clear stay available', /<details class="lcat-more" open data-lcat-more>/.test(cat) && /<summary class="lcat-more-sum"><span>Filters<\/span>/.test(cat) && cat.indexOf('id="f-q"') < cat.indexOf('data-lcat-more') && /data-lcat-active/.test(cat) && /type="reset" class="lcat-reset">Clear/.test(cat) && /max-width: 700px/.test(cat));
  t('the filter fields and their names are unchanged (behaviour preserved)', ['name="q"', 'name="state"', 'name="design"', 'name="type"', 'name="status"', 'name="sort"'].every((n) => cat.includes(n)));
  t('the existing filters are kept and sit before the results', ['f-q', 'f-state', 'f-design', 'f-type', 'f-status', 'f-sort'].every((id) => cat.includes(`id="${id}"`)) && cat.indexOf('data-lcat-filters') < cat.indexOf('class="lcat-grid"'));
  t('the page keeps its #listings and #access anchors', /id="listings"/.test(cat) && /id="access"/.test(page));
}
