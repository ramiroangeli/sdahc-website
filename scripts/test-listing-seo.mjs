// Listing-specific search and AI metadata: titles, descriptions, canonical and breadcrumb wiring, structured data, social images, related properties,
// market context and internal links. Synthetic data only; the real approved files are only read.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const NT = JSON.parse(rd('src/data/listings/approved/whipray-circuit-berrimah-nt.json'));
  const ap = (inv) => ({ ...inv, approval: { valuesHash: L.investmentValuesHash({ ...inv, approval: { valuesHash: '0'.repeat(64) } }) } });
  const FULL = { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied', annualIncomeAud: 132704, incomeType: 'net', yieldPct: 11.1, yieldType: 'net', basis: 'projected', tenure: 'Long-term lease to a registered SDA provider' };
  let n = 0;
  const pl = ({ state = 'NT', suburb = 'Berrimah', status = 'available', slug, id, mod } = {}) => {
    n += 1; const c = structuredClone(NT.content); c.address = { ...c.address, state, suburb }; if (mod) mod(c);
    return { ...c, slug: slug ?? `seo-test-${'abcdefghij'[n % 10]}${'klmnopqrst'[(n * 3) % 10]}-nt`, id: id ?? `lst_${String(n).padStart(10, '0')}`, summary: 'First paragraph of the description with a claim of high-yielding returns.', commercialStatus: status, featured: false, version: 1, publishedAt: `2026-11-0${(n % 9) + 1}`, updatedAt: '2026-11-10', isDemo: false };
  };
  const FIN = /yield|income|return|lease|tenant|occup|provider|\$\d|\d%|price|rent/i;

  section('listing SEO: titles');
  const av = pl({ mod: (c) => { c.title = 'Anything'; } });
  t('Available: category, place and "for sale" (the pattern from the brief)', L.listingSeoTitle(av) === 'Robust SDA property for sale in Berrimah, NT | SDA Home Choices');
  t('Under offer never reads as available; Sold is never "for sale"', /under offer in Berrimah, NT/.test(L.listingSeoTitle(pl({ status: 'under_offer' }))) && !/for sale/.test(L.listingSeoTitle(pl({ status: 'under_offer' }))) && /^Sold /.test(L.listingSeoTitle(pl({ status: 'sold' }))) && !/for sale/.test(L.listingSeoTitle(pl({ status: 'sold' }))));
  t('a portfolio is called a portfolio; a missing category is simply omitted (nothing invented)', /SDA portfolio for sale/.test(L.listingSeoTitle(pl({ mod: (c) => { c.type = 'portfolio'; } }))) && L.listingSeoTitle(pl({ mod: (c) => { c.sda = {}; } })) === 'SDA property for sale in Berrimah, NT | SDA Home Choices');
  t('several categories are all named', /^High Physical Support, Improved Liveability SDA property/.test(L.listingSeoTitle(pl({ mod: (c) => { c.sda = { designCategories: ['HPS', 'IL'] }; } }))));
  const twins = [pl({ id: 'lst_a000000001', slug: 'twin-one-nt' }), pl({ id: 'lst_a000000002', slug: 'twin-two-nt', mod: (c) => { c.address.street = 'Other Street'; } })];
  const titles = L.uniqueSeoTitles(twins);
  t('titles are unique: identical ones are told apart by the public street name', new Set(titles.values()).size === 2 && /\(Whipray Circuit\)/.test(titles.get('lst_a000000001')) && /\(Other Street\)/.test(titles.get('lst_a000000002')));
  t('a unique title is left exactly as it is', L.uniqueSeoTitles([av]).get(av.id) === L.listingSeoTitle(av));
  t('titles carry no financial, tenancy or private word', ![av, pl({ status: 'sold' }), pl({ status: 'under_offer' })].some((l) => FIN.test(L.listingSeoTitle(l))));

  section('listing SEO: meta descriptions');
  const rich = pl({ mod: (c) => { c.sda = { designCategories: ['IL'], buildingType: 'House', bedrooms: 3 }; c.property = { bathrooms: 2 }; c.investment = ap(FULL); } });
  const d = L.listingSeoDescription(rich);
  t('built from approved structured facts, with the next step, 160 characters or fewer', d.length <= 160 && /Improved Liveability SDA property for sale in Berrimah, NT \(House, 3 bedrooms, 2 bathrooms\)\./.test(d) && /Register your interest/.test(d));
  t('never uses the free-text description (a marketing claim in the first paragraph does not appear)', !/high-yielding|claim/.test(d));
  t('never mentions income, yield, tenancy, occupancy, provider or price, even when they are approved', !FIN.test(d) && !FIN.test(L.listingSeoDescription(pl({ mod: (c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; c.investment = ap(FULL); } }))));
  t('Sold says it has sold and asks what the visitor is looking for; Under offer says so', /^Sold:/.test(L.listingSeoDescription(pl({ status: 'sold' }))) && !/for sale/.test(L.listingSeoDescription(pl({ status: 'sold' }))) && /^Under offer:/.test(L.listingSeoDescription(pl({ status: 'under_offer' }))));
  t('a long set of facts is dropped before the call to action is cut off', (() => { const long = L.listingSeoDescription(pl({ suburb: 'Mount Barker Summit', mod: (c) => { c.sda = { designCategories: ['HPS', 'IL', 'Robust'], buildingType: 'Villa duplex apartment', bedrooms: 4 }; c.property = { bathrooms: 3 }; } })); return long.length <= 160 && !long.endsWith('…') && /SDA Home Choices\.$/.test(long); })());
  t('the description is unique in effect: it names suburb and state', /Berrimah, NT/.test(d));

  section('listing SEO: social image');
  const og = L.listingOgImageInfo(pl());
  t('the first photograph that is not a floorplan, at its widest size, with real dimensions and its approved description as alt', og.url.endsWith('-1600.webp') && og.width === 1600 && og.height === Math.round(1600 * 2695 / 4000) && og.alt === 'Front');
  t('a floorplan is used only when it is the only image; no photographs or a demo photo: none (the brand card applies)', L.listingOgImageInfo(pl({ mod: (c) => { c.photos = [c.photos[2]]; } })).alt === 'Floorplan' && L.listingOgImageInfo(pl({ mod: (c) => { c.photos = []; } })) === undefined && L.listingOgImageInfo(pl({ mod: (c) => { c.photos = [{ demo: true, id: 'demo-a-one', accent: 'blue', alt: 'DEMO placeholder image 1 of 1.' }]; } })) === undefined);
  const layout = rd('src/layouts/BaseLayout.astro');
  t('the layout takes optional image width, height and alt; without them every other page keeps the brand card values', /ogImageWidth = 1200/.test(layout) && /ogImageHeight = 630/.test(layout) && /ogImageAlt \?\? 'SDA Home Choices'/.test(layout) && /\{ogImageUrl && ogImageAlt && <meta name="twitter:image:alt"/.test(layout));

  section('listing SEO: structured data');
  const node = (l) => L.listingNode(l, 'https://sdahomechoices.com.au');
  const nn = node(pl({ mod: (c) => { c.sda = { designCategories: ['IL'], bedrooms: 3 }; c.property = { bathrooms: 2, floorAreaM2: 262 }; c.pricing = { mode: 'asking_price', display: '$695,000' }; c.investment = ap(FULL); } }));
  t('a RealEstateListing with an @id, language, link to the website and the firm, and dates', nn['@type'] === 'RealEstateListing' && /#listing$/.test(nn['@id']) && nn.inLanguage === 'en-AU' && nn.isPartOf['@id'] === 'https://sdahomechoices.com.au/#website' && nn.publisher['@id'] === 'https://sdahomechoices.com.au/#organization' && !!nn.datePosted && !!nn.dateModified);
  t('images are ImageObjects with real dimensions and the approved description as caption; the floorplan is named', nn.image.length === 3 && nn.image[0].caption === 'Front' && nn.image[0].width === 1600 && nn.image.some((i) => i.name === 'Floorplan') && nn.primaryImageOfPage.url === nn.image[0].url);
  t('the place is an Accommodation with the public address only, and approved physical facts', nn.about['@type'] === 'Accommodation' && nn.about.address.streetAddress === 'Whipray Circuit' && !/\d/.test(nn.about.address.streetAddress) && nn.about.numberOfBedrooms === 3 && nn.about.numberOfBathroomsTotal === 2 && nn.about.floorSize.value === 262 && nn.about.floorSize.unitCode === 'MTK');
  t('an offer only for an Available property with an approved public price, with InStock', nn.offers.price === 695000 && nn.offers.availability === 'https://schema.org/InStock' && !('offers' in node(pl({ status: 'under_offer', mod: (c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; } }))) && !('offers' in node(pl({ status: 'sold', mod: (c) => { c.pricing = { mode: 'asking_price', display: '$695,000' }; } }))) && !('offers' in node(pl())));
  const json = JSON.stringify(nn);
  t('no income, yield, tenancy, occupancy, provider, approval, hash or coordinate field anywhere in it', !/132704|11\.1|yield|income|lease|occup|provider|tenure|valuesHash|approval|latitude|longitude|geo"/i.test(json));
  t('the standalone document form keeps its context', L.listingJsonLd(pl(), 'https://sdahomechoices.com.au')['@context'] === 'https://schema.org');
  t('optional facts are simply absent when not approved', (() => { const m = node(pl()).about; return !('numberOfBedrooms' in m) && !('floorSize' in m) && !('numberOfBathroomsTotal' in m); })());

  section('listing SEO: page wiring');
  const page = rd('src/pages/opportunities/[slug].astro');
  t('the canonical comes from the layout (one per page, the page address); the page passes title, description, image, breadcrumbs and the listing node', /<BaseLayout title=\{title\} description=\{description\} ogImage=\{og\?\.url\} ogImageWidth=\{og\?\.width\} ogImageHeight=\{og\?\.height\} ogImageAlt=\{og\?\.alt\} breadcrumbs=\{breadcrumbs\} schema=\{\[listingNode\(listing, Astro\.site!\.href\)\]\}>/.test(page) && /const canonical = new URL\(Astro\.url\.pathname, Astro\.site\)\.href/.test(layout));
  t('one linked graph: the standalone JSON-LD script is gone', !/application\/ld\+json/.test(page));
  t('BreadcrumbList: Home, Opportunities, the listing; with a matching visible breadcrumb trail', /breadcrumbs = \[\{ name: 'Opportunities', path: '\/opportunities\/' \}, \{ name: listing\.title, path: listingPath\(listing\) \}\]/.test(page) && /<nav class="ld-crumbs" aria-label="Breadcrumb">/.test(page) && /aria-current="page"/.test(page));
  t('the description and title come from the generators, never from the free-text summary', /uniqueSeoTitles\(everyListing\)\.get\(listing\.id\)/.test(page) && /listingSeoDescription\(listing\)/.test(page) && !/listing\.summary/.test(page));
  const cfg = rd('astro.config.mjs');
  t('the sitemap gives each listing page the date its public content last changed (from its approved snapshot)', /listingDates\[path\]/.test(cfg) && /s\.approvedAt/.test(cfg));

  section('listing SEO: related properties');
  const base = pl({ state: 'VIC', id: 'lst_b000000001', slug: 'base-vic', mod: (c) => { c.sda = { designCategories: ['IL'] }; } });
  const sameState = pl({ state: 'VIC', id: 'lst_b000000002', slug: 'same-state-vic', mod: (c) => { c.sda = { designCategories: ['HPS'] }; } });
  const sameCat = pl({ state: 'QLD', id: 'lst_b000000003', slug: 'same-cat-qld', mod: (c) => { c.sda = { designCategories: ['IL'] }; } });
  const both = pl({ state: 'VIC', id: 'lst_b000000004', slug: 'both-vic', mod: (c) => { c.sda = { designCategories: ['IL'] }; } });
  const neither = pl({ state: 'WA', id: 'lst_b000000005', slug: 'neither-wa', mod: (c) => { c.sda = { designCategories: ['Robust'] }; } });
  const sold = pl({ state: 'VIC', status: 'sold', id: 'lst_b000000006', slug: 'sold-vic', mod: (c) => { c.sda = { designCategories: ['IL'] }; } });
  const all = [base, sameState, sameCat, both, neither, sold];
  const rel = L.relatedListings(base, all);
  t('same state and category first, then state, then category; never itself, a Sold property or an unrelated one', rel.map((x) => x.slug).join() === 'both-vic,same-state-vic,same-cat-qld' && !rel.includes(base) && !rel.includes(sold) && !rel.includes(neither));
  t('at most three, and none when nothing is related (the section does not render)', L.relatedListings(base, all, 2).length === 2 && L.relatedListings(neither, [neither, base]).length === 0 && L.relatedListings(base, [base]).length === 0);
  t('a withdrawn listing cannot appear: related properties come only from the published list the page already has', /const everyListing = getPublicListings\(\)/.test(page) && /relatedListings\(listing, everyListing\)/.test(page) && /related\.length > 0/.test(page));

  section('listing SEO: market context and internal links');
  const ctx = L.marketContext(pl({ state: 'VIC' }));
  const stats = rd('src/data/sda-states.json'); const statsJson = JSON.parse(stats);
  t('the figure is SDAHC Research\'s own, from the same file as the statistics page and the research map', ctx.stateDwellings === statsJson.VIC.d.toLocaleString('en-AU') && ctx.nationalDwellings === statsJson.NATIONAL.d.toLocaleString('en-AU') && ctx.stateName === 'Victoria');
  const statsPage = rd('src/pages/sda-statistics.astro');
  t('its date and source match what the statistics page states (a stale constant fails here)', statsPage.includes(L.MARKET_FIGURES_AS_AT) && statsPage.includes(L.MARKET_FIGURES_SOURCE.split(';')[0]) && statsPage.includes(statsJson.NATIONAL.d.toLocaleString('en-AU')));
  t('every state has context and a research page that exists', ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].every((s) => { const c = L.marketContext(pl({ state: s })); return c && existsSync(join(repoRoot, 'src/pages', c.statePage.replace(/^\//, '').replace(/\/$/, '') + '.astro')); }));
  const links = L.resourceLinks(pl({ state: 'NT' }));
  t('every internal link goes to a real page, with a descriptive anchor and a note', links.length >= 5 && links.every((l) => (existsSync(join(repoRoot, 'src/pages', l.href.replace(/^\//, '').replace(/\/$/, '') + '.astro')) || existsSync(join(repoRoot, 'src/pages', l.href.replace(/^\//, ''), 'index.astro'))) && l.text.length > 8 && l.note.length > 8));
  const res = rd('src/components/ListingResources.astro');
  t('the context is labelled as general market information, not a statement about the property, and quotes no property performance', /not a statement about this property/.test(res) && !/yield|income|return|occupan|demand/i.test(res.replace(/---[\s\S]*?---/, '')));
  t('no FAQ or other generic filler is added to the listing page', !/FAQ|faqPage/i.test(page + res + rd('src/components/RelatedListings.astro')));

  section('listing SEO: the benchmark');
  const bench = rd('docs/seo-benchmark-queries.md');
  const rows = bench.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  t('at least 30 queries in the eight required groups, each mapped to a destination', rows.length >= 30 && ['National property discovery', 'State and regional discovery', 'SDA category and accommodation type', 'Established versus development opportunities', 'Existing income, provider arrangements and investment risk', 'Buyer due diligence', 'Portfolio acquisition and distressed assets', 'SDAHC research and advisory expertise'].every((g) => bench.includes(g)) && rows.every((r) => r.split('|').length >= 5));
  t('it names how results are measured: search visibility, referrals and enquiries, AI citations', /Google Search Console/.test(bench) && /enquir/i.test(bench) && /AI citations/.test(bench));
  t('the brief\'s own example queries are included', ['Where can I buy Specialist Disability Accommodation property in Australia?', 'Are there SDA properties for sale in Victoria?', 'Where can I find distressed SDA assets for acquisition?', 'Which brokers specialise in SDA investment property?'].every((q) => bench.includes(q)));
}
