// Individual listing page: what it may show (pure view model) and the structure of the page, gallery and panels. Synthetic data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const NT = JSON.parse(rd('src/data/listings/approved/whipray-circuit-berrimah-nt.json'));
  const ap = (inv) => ({ ...inv, approval: { valuesHash: L.investmentValuesHash({ ...inv, approval: { valuesHash: '0'.repeat(64) } }) } });
  const FULL = { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied', annualIncomeAud: 132704, incomeType: 'net', yieldPct: 11.1, yieldType: 'net', basis: 'projected', tenure: 'Long-term lease to a registered SDA provider' };
  const pl = ({ state = 'NT', status = 'available', mod } = {}) => {
    const c = structuredClone(NT.content); c.address = { ...c.address, state }; if (mod) mod(c);
    return { ...c, id: 'lst_0000000001', summary: 'Summary text here.', commercialStatus: status, featured: false, version: 1, publishedAt: '2026-11-10', updatedAt: '2026-11-10', isDemo: false };
  };

  section('listing page: header');
  t('the location line is the public address, shown only when the title does not already give street and suburb', L.detailLocation(pl()) === undefined && L.detailLocation(pl({ mod: (c) => { c.title = 'Armstrong Creek VIC | IL SDA Investment'; } })) === 'Whipray Circuit, Berrimah NT 0832');
  t('the location line never carries a house or unit number', !/\d{1,3}\s+Whipray/.test(L.detailLocation(pl({ mod: (c) => { c.title = 'Established SDA house'; } }))));
  t('the design category is stated in words, and absent when not verified', L.designText(pl()) === 'Robust' && L.designText(pl({ mod: (c) => { c.sda = {}; } })) === undefined);

  section('listing page: key property information');
  t('a listing with no optional facts has an empty list (the section is not rendered)', L.detailFacts(pl()).length === 0);
  const rich = L.detailFacts(pl({ mod: (c) => { c.sda = { designCategories: ['IL'], buildingType: 'House', bedrooms: 3, residentPlaces: 3, ooa: 'Onsite overnight assistance (OOA) available' }; c.property = { bathrooms: 3, carSpaces: 2, parking: 'Double lock-up garage', floorAreaM2: 262, landAreaM2: 1448, municipality: 'City of Palmerston' }; } }));
  t('approved facts appear in a fixed order with their labels', rich.map((r) => r.label).join('|') === 'Build type|Bedrooms|Bathrooms|Car spaces|Parking|Floor area|Land area|Municipality|Participant places|Onsite overnight assistance');
  t('areas are formatted with m2 and thousands separators', rich.find((r) => r.label === 'Floor area').value === '262 m²' && rich.find((r) => r.label === 'Land area').value === '1,448 m²');
  t('the design category is not repeated in the facts (it is in the header)', !rich.some((r) => /design/i.test(r.label)));
  t('zero car spaces is a real value and is shown; missing values are omitted', L.detailFacts(pl({ mod: (c) => { c.property = { carSpaces: 0 }; } })).map((r) => `${r.label}:${r.value}`).join() === 'Car spaces:0');

  section('listing page: investment details');
  const inv = (o) => L.detailInvestment(pl(o));
  t('no commercial information means no section', inv() === null);
  t('approved figures show the yield, income with its basis, and lease and occupancy as separate rows', (() => { const s = inv({ mod: (c) => { c.investment = ap(FULL); } }); const labels = s.rows.map((r) => r.label); return s.yield.text === '11.1%' && s.yield.label === 'Net yield' && s.yield.basis === 'Projected' && labels.includes('Lease status') && labels.includes('Occupancy status') && labels.includes('Net annual income (projected)') && s.rows.find((r) => r.label.startsWith('Net annual')).value === '$132,704 per year'; })());
  t('lease only: no occupancy row; occupancy only: no lease row', (() => { const a = inv({ mod: (c) => { c.investment = ap({ leaseStatus: 'fully_leased' }); } }); const b = inv({ mod: (c) => { c.investment = ap({ occupancyStatus: 'vacant' }); } }); return a.rows.length === 1 && a.rows[0].label === 'Lease status' && b.rows.length === 1 && b.rows[0].label === 'Occupancy status'; })());
  t('Victoria: lease and occupancy only, never income or yield', (() => { const s = L.detailInvestment(pl({ state: 'VIC', mod: (c) => { c.investment = ap(FULL); } })); return !s.yield && !s.rows.some((r) => /income/i.test(r.label)) && s.rows.some((r) => r.label === 'Lease status'); })());
  t('Sold shows no investment section', inv({ status: 'sold', mod: (c) => { c.investment = ap(FULL); } }) === null);
  t('Under offer still shows approved facts', inv({ status: 'under_offer', mod: (c) => { c.investment = ap(FULL); } }) !== null);
  t('unapproved or altered figures show nothing', inv({ mod: (c) => { c.investment = { ...ap(FULL), yieldPct: 15 }; } }) === null);
  t('provider wording needs its own authorisation', !inv({ mod: (c) => { c.investment = ap({ leaseStatus: 'fully_leased' }); } }).rows.some((r) => r.label === 'Provider arrangement') && inv({ mod: (c) => { c.investment = ap({ leaseStatus: 'fully_leased', providerArrangement: 'Existing SDA provider arrangement' }); c.investment.approval.provider = true; c.investment.approval.valuesHash = L.investmentValuesHash({ ...c.investment }); } }).rows.some((r) => r.label === 'Provider arrangement'));
  t('the section never carries the approval hash or an identity', !/valuesHash|approval|@/.test(JSON.stringify(inv({ mod: (c) => { c.investment = ap(FULL); } }))));

  section('listing page: pricing and gallery plan');
  t('an approved price is shown as approved on an Available listing, the existing wording otherwise, and nothing when Sold', L.detailPricing(pl({ mod: (c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; } })).value === '$695,000 AUD' && L.detailPricing(pl()).value === 'Enquire for details' && L.detailPricing(pl({ status: 'sold' })) === null);
  const ph = NT.content.photos; // front, park, floorplan
  const gp = L.galleryPlan(ph);
  t('the main photograph is the first that is not a floorplan; thumbnails keep the approved order, floorplan last', gp.mainIndex === 0 && gp.thumbIndexes.join() === '1,2' && gp.floorplanIndex === 2);
  t('a floorplan listed first is never the main photograph', (() => { const g = L.galleryPlan([ph[2], ph[0], ph[1]]); return g.mainIndex === 1 && g.floorplanIndex === 0 && g.thumbIndexes.join() === '0,2'; })());
  t('only a floorplan: there is no main photograph (the floorplan is shown whole); no photographs: an empty plan', L.galleryPlan([ph[2]]).mainIndex === -1 && L.galleryPlan([]).thumbIndexes.length === 0 && L.galleryPlan([]).floorplanIndex === -1);

  section('listing page: components and structure');
  const page = rd('src/pages/opportunities/[slug].astro');
  const gal = rd('src/components/ListingGallery.astro');
  const facts = rd('src/components/ListingFacts.astro');
  const invc = rd('src/components/ListingInvestment.astro');
  const ag = rd('src/components/AgencyPanel.astro');
  t('one H1 (the approved title), then status, type and design category badges and the location line', (page.match(/<h1 /g) || []).length === 1 && /<h1 class="ld-h1">\{listing\.title\}<\/h1>/.test(page) && /ListingStatusBadge status=\{listing\.commercialStatus\}/.test(page) && /\{location && <p class="ld-loc">/.test(page));
  t('section order: gallery, key information, investment (optional), about, agency panel beside, then the enquiry section', (() => { const i = (s) => page.indexOf(s); return i('<ListingGallery') < i('<ListingFacts') && i('<ListingFacts') < i('<ListingInvestment') && i('<ListingInvestment') < i('About this property') && i('About this property') < i('<AgencyPanel') && i('<AgencyPanel') < i('id="enquire"'); })());
  t('the existing enquiry form, its endpoint and the Sold alternative are unchanged', /ListingEnquiryForm listingId=\{listing\.id\} listingTitle=\{listing\.title\}/.test(page) && /data-endpoint="\/api\/listing-enquiry\/"/.test(rd('src/components/ListingEnquiryForm.astro')) && /This property has been sold/.test(page) && /\{sold \? \(/.test(page));
  t('the enquiry button is absent on a Sold listing (header and panel)', /\{!sold && <a class="btn b1 ld-head-cta" href="#enquire">/.test(page) && /\{sold \? \(/.test(ag));
  t('facts and investment render nothing when empty (no empty headings or placeholders)', /\{rows\.length > 0 && \(/.test(facts) && /\{section && \(/.test(invc));
  t('the investment note says the figures are supplied by the agent and are not a forecast or guarantee', /not a forecast or a guarantee of return/.test(invc) && !/guaranteed|guarantee[ds]? return of/i.test(invc.replace('not a forecast or a guarantee of return', '')));
  t('lease and occupancy are separate rows in the section builder', /label: 'Lease status'/.test(rd('src/data/listings/detail.ts')) && /label: 'Occupancy status'/.test(rd('src/data/listings/detail.ts')));
  t('the agency panel uses the registry logo and name, shows contact lines for the default agency only, and has no profile link', /agency\.logoOnDark/.test(ag) && /isDefault && \(/.test(ag) && /agency\.name/.test(ag) && !/href="[^"]*profile/i.test(ag));
  t('structured data is built exactly as before (no new field reaches it)', /listingJsonLd\(listing, Astro\.site!\.href\)/.test(page) && !/investment|yield|income/i.test(rd('src/data/listings/seo.ts')));

  section('listing page: gallery');
  t('thumbnails are plain links to the full image without JavaScript, and open a native dialog viewer with it', /href=\{href\(i\)\} data-gx-open=\{i\}/.test(gal) && /<dialog class="gx-dlg"/.test(gal) && /dlg\.showModal\(\)/.test(gal) && /e\.preventDefault\(\); open\(/.test(gal));
  t('keyboard: arrows move between images, Escape closes (native dialog), focus returns to the opener', /e\.key === 'ArrowLeft'/.test(gal) && /e\.key === 'ArrowRight'/.test(gal) && /opener\?\.focus\(\)/.test(gal) && /gx-x" data-gx-close/.test(gal));
  t('every control has an accessible name; thumbnails carry the description once (alt empty on the image, label on the link)', /aria-label=\{`Open \$\{label\(i\)\}`\}/.test(gal) && /alt=""/.test(gal) && /aria-label="Previous photograph"/.test(gal) && /aria-label="Next photograph"/.test(gal) && /aria-label="Close the viewer"/.test(gal) && /role="status" aria-live="polite"/.test(gal));
  t('the approved description is the alt text of the main and viewer images, and a caption in the viewer', !/alt=\{?""/.test(gal.split('gx-thumbs')[0].split('<ListingImage photo={photos[plan.mainIndex]}')[1].split('/>')[0]) && /<figcaption class="gx-cap">/.test(gal));
  t('floorplans are labelled and shown whole (contained), the main photograph and thumbnails are cropped to fixed shapes', /isFloorplan\(photos\[i\]\) && <span class="gx-tag">Floorplan<\/span>/.test(gal) && /whole=\{isFloorplan\(photos\[i\]\)\}/.test(gal) && /\.gx-thlink\{[^}]*aspect-ratio:4\/3/.test(gal) && /\.gx-main\{[^}]*aspect-ratio:3\/2/.test(gal));
  t('a floorplan hidden behind the +N tile stays reachable through a "View the floorplan" link', /View the floorplan/.test(gal) && /!shownThumbs\.includes\(plan\.floorplanIndex\)/.test(gal));
  t('the viewer images are lazy and only loaded when shown (closed dialog content is not fetched)', /im\.loading = 'eager'/.test(gal) && /<ListingImage photo=\{p\} whole largest/.test(gal));
  t('layouts: side (main beside a block of thumbnails), row (thumbnails under) and solo; an empty state with no photographs', /gx--\$\{layout\}/.test(gal) && /shownThumbs\.length >= 4 \? 'side'/.test(gal) && /Approved photography will appear here\./.test(gal));
  t('photograph order is untouched: thumbnails follow the approved order and no file, upload or privacy code is changed', /thumbIndexes: photos\.map\(\(_, i\) => i\)\.filter/.test(rd('src/data/listings/detail.ts')));
}
