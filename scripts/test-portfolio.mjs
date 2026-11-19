// Property portfolios: ONE public listing for several properties. Synthetic data only (the real approved files are only read as a base for photographs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const MEDIA = 'https://leojshpooxhtztim.public.blob.vercel-storage.com';
  const NT = JSON.parse(rd('src/data/listings/approved/whipray-circuit-berrimah-nt.json'));
  const photos = structuredClone(NT.content.photos);
  const compliance = JSON.parse(rd('src/data/listings/compliance.json'));
  const ctx = { allowDemo: false, mediaBaseUrl: MEDIA, compliance, authorisedApproverIds: [] };
  const ID = 'lst_a1b2c3d4e5';
  const FIG = { kind: 'gross_income_aud', amount: 99509, basis: 'actual', period: 'FY26', scope: 'all' };
  const request = (over = {}) => ({ title: 'Berrimah SDA Portfolio', description: 'A portfolio of SDA homes in Berrimah.\n\nContact SDA Home Choices.', coverage: 'Berrimah, Northern Territory', states: ['NT'], propertyCount: 3, saleMode: 'both', pricingMode: 'contact_agent', displayPrice: null, ...over });
  const build = (over = {}, o = {}) => L.buildPortfolioContent({ publicId: ID, request: request(over), photos, previous: null, otherSlugs: new Set(['whipray-circuit-berrimah-nt']), status: 'available', ctx, compliance, ...o });

  section('portfolio: the public contract');
  const ok = build();
  t('a valid portfolio builds: type, slug from the title (letters only), no address, a portfolio block', !!ok.content && ok.content.type === 'portfolio' && ok.content.slug === 'berrimah-sda-portfolio' && !ok.content.address && ok.content.portfolio.propertyCount === 3);
  t('no digits can be in a slug or a coverage line (house numbers cannot ride along)', L.portfolioSlug('Berrimah 21 SDA Portfolio') === 'berrimah-sda-portfolio' && build({ coverage: '21 Whipray Circuit, Berrimah' }).issues.length > 0);
  t('an individual property still needs its address, and cannot carry a portfolio block', !L.publicContentSchema.safeParse({ ...NT.content, address: undefined }).success && !L.publicContentSchema.safeParse({ ...NT.content, portfolio: ok.content.portfolio }).success);
  t('a portfolio cannot carry an address, an investment block, property facts or a marketing agency', !L.publicContentSchema.safeParse({ ...ok.content, address: NT.content.address }).success && !L.publicContentSchema.safeParse({ ...ok.content, marketing: { agency: 'sda-home-choices' } }).success);
  t('at least two properties, and the schema is strict', build({ propertyCount: 1 }).issues.length > 0 && !L.portfolioSchema.safeParse({ ...ok.content.portfolio, extra: 1 }).success);
  t('the slug stays the same on an update (identity), and a title change does not move it', build({ title: 'A totally different title for it' }, { previous: { ...NT, content: { ...ok.content } } }).content.slug === 'berrimah-sda-portfolio');
  t('a title that would take another listing\'s web address is refused', build({ title: 'Whipray Circuit Berrimah NT Portfolio' }, { otherSlugs: new Set(['whipray-circuit-berrimah-nt-portfolio']) }).issues.some((i) => /another listing/.test(i)));
  t('a portfolio needs a photograph', build({}, { photos: [] }).issues.some((i) => /photograph/.test(i)));

  section('portfolio: figures are stated, never calculated');
  const fig = build({ commercial: { figures: [FIG, { kind: 'net_yield_pct', amount: 9.5, basis: 'projected', period: 'FY27', scope: 'some', count: 2 }] }, description: 'Portfolio of SDA homes. Net yield stated below.' });
  t('figures are copied as stated with their own basis, period and coverage; an approval hash is computed here', !!fig.content && fig.content.portfolio.figures.length === 2 && /^[a-f0-9]{64}$/.test(fig.content.portfolio.approval.valuesHash) && fig.content.portfolio.figures[1].count === 2);
  t('the approval is bound to the values: changing a figure without re-approval fails the safety check', (() => { const c = structuredClone(fig.content); c.portfolio.figures[0].amount = 150000; return L.checkPublicSafety(c, ctx).some((i) => /not approved/.test(i)); })());
  const v = L.portfolioView({ portfolio: fig.content.portfolio, commercialStatus: 'available' });
  t('the page shows each figure on its own with basis and coverage; there is no total or average anywhere', v.figures.length === 2 && v.figures[0].basis === 'Actual' && v.figures[1].coverage === '2 of 3 properties' && v.figures[0].coverage === 'All 3 properties' && !('total' in v) && !('average' in v));
  t('a Sold portfolio carries and shows no figures', (() => { const s = build({ commercial: { figures: [FIG] } }, { status: 'sold' }); return !s.content.portfolio.figures && L.portfolioView({ portfolio: s.content.portfolio, commercialStatus: 'sold' }).figures.length === 0; })());
  t('a figure for some properties must say how many, and cannot cover more than the portfolio has', !L.portfolioFigureSchema.safeParse({ ...FIG, scope: 'some' }).success && build({ commercial: { figures: [{ ...FIG, scope: 'some', count: 9 }] } }).issues.length > 0);
  t('the same kind of figure cannot appear twice (no quiet double counting)', build({ commercial: { figures: [FIG, { ...FIG, amount: 1000 }] } }).issues.length > 0);
  t('lease and occupancy of the whole are shown only when approved (hash bound), never inferred', (() => { const l = build({ commercial: { lease: 'fully_leased' } }); return l.content.portfolio.leaseStatus === 'fully_leased' && !!l.content.portfolio.approval && L.portfolioView({ portfolio: l.content.portfolio, commercialStatus: 'available' }).lease === 'Fully leased' && !L.portfolioView({ portfolio: ok.content.portfolio, commercialStatus: 'available' }).lease; })());

  section('portfolio: Victoria and privacy');
  const vic = build({ states: ['VIC', 'NT'], commercial: { figures: [FIG] }, description: 'Portfolio of SDA homes.' });
  t('a portfolio that includes Victoria shows income and yield only under the business authorisation flag, which the declaration sets and the hash binds', !!vic.content && vic.content.portfolio.approval.victorian === true && L.portfolioView({ portfolio: vic.content.portfolio, commercialStatus: 'available' }).figures.length === 1
    && L.portfolioView({ portfolio: { ...vic.content.portfolio, approval: { valuesHash: vic.content.portfolio.approval.valuesHash } }, commercialStatus: 'available' }).figures.length === 0);
  t('Victorian pricing needs its clearance (default deny) like an individual listing', build({ states: ['VIC'], pricingMode: 'asking_price', displayPrice: 4500000 }, { compliance: { ...compliance, victoria: { ...compliance.victoria, cleared: { asking_price: false, price_guide: false, eoi: false, contact_agent: false }, determinations: [] } } }).issues.some((i) => /Victorian pricing/.test(i)));
  t('a description with an email address or a phone number is refused', ['Write to a@b.com', 'Call 0408 550 441'].every((d) => build({ description: d }).issues.length > 0));
  t('commercial wording in the description travels under a description approval bound to the exact text (the Publisher\'s declaration), as for an individual listing', (() => { const d = build({ description: 'Income of $164,435 a year.' }); return !!d.content && /^[a-f0-9]{64}$/.test(d.content.descriptionApproval.textHash) && L.checkPublicSafety({ ...d.content, description: ['Income of $999 a year.'] }, ctx).length > 0; })());
  t('a participant is never named', build({ description: 'The resident John Smith lives there.' }).issues.length > 0);
  t('the public content carries no member address or CRM identifier (nothing of the kind exists in the shape)', (() => { const j = JSON.stringify({ ...ok.content, photos: [] }); return !/notion|members|crm|internal|lst_|portfolio:/i.test(j.replace(/"type":"portfolio"/g, '').replace(/"portfolio":\{/g, '"p":{')); })());

  section('portfolio: card, page, search engines');
  const listing = (c, extra = {}) => ({ ...c, id: ID, summary: 'A portfolio of SDA homes in Berrimah.', commercialStatus: 'available', featured: false, version: 1, publishedAt: 'x', updatedAt: 'x', isDemo: false, ...extra });
  const pl = listing(ok.content);
  t('the public listing parses with the strict schema', L.publicListingSchema.safeParse(pl).success);
  const card = L.cardView(pl);
  t('the card says how many properties and how it is sold, shows the coverage line only when the title does not, and no property facts', card.facts.parts.join('|') === '3 properties|Either as one portfolio or property by property' && card.location === 'Berrimah, Northern Territory' && !card.facts.design);
  t('the page location and glance rows describe the whole; the figures section lists each figure on its own', L.detailLocation(pl) === 'Berrimah, Northern Territory' && L.portfolioGlanceRows(L.portfolioView(pl)).map((r) => r.label).join() === 'Properties,Location,How it is sold' && L.portfolioFigureRows(L.portfolioView(listing(fig.content))).length === 2);
  t('the label is "Property portfolio" and the search-engine title and structured data use the coverage, not an address', L.TYPE_LABEL.portfolio === 'Property portfolio' && /SDA portfolio for sale in Berrimah, Northern Territory/.test(L.listingSeoTitle(pl)) && L.listingNode(pl, 'https://sdahomechoices.com.au').about.name === 'Berrimah, Northern Territory' && !JSON.stringify(L.listingNode(pl, 'https://sdahomechoices.com.au')).includes('PostalAddress'));
  t('states of a portfolio are all searchable, and market context is given only for a single state', L.listingStates(pl).join() === 'NT' && L.listingStates(listing(build({ states: ['NT', 'QLD'] }).content)).join() === 'NT,QLD' && L.marketContext(listing(build({ states: ['NT', 'QLD'] }).content)) === null && L.marketContext(pl) !== null);
  t('it is built with the ordinary pipeline: one entry, hidden when withdrawn, ordered by the existing rule', (() => {
    const snap = L.nextPortfolioSnapshot(ID, ok.content, null, { status: 'available', featured: false, at: '2026-11-18T00:00:00Z' });
    const rec = { id: ID, webStatus: 'published', featured: false, draft: null, approval: { by: 'SDA Home Choices', at: snap.approvedAt }, isFixture: false, internal: {} };
    const one = L.buildPublicListings({ records: [rec], snapshots: [snap], now: new Date('2026-11-19T00:00:00Z'), ctx, order: [] });
    const gone = L.buildPublicListings({ records: [rec], snapshots: [snap], now: new Date('2026-11-19T00:00:00Z'), ctx, withdrawn: new Set([ID]), order: [] });
    return one.length === 1 && one[0].type === 'portfolio' && gone.length === 0;
  })());
  t('the card carries every state in data-state so the state filter finds it; the hero fan shows individual properties only', /data-state=\{states\.join\(' '\)\}/.test(rd('src/components/ListingCard.astro')) && /\.split\(' '\)\.includes\(f\.state\)/.test(rd('src/components/ListingsCatalogue.astro')) && /filter\(\(l\) => !!l\.address\)/.test(rd('src/components/HeroCardFan.astro')));
  t('the enquiry form sends the portfolio id and the page says portfolio, not property', /listingId=\{listing\.id\}/.test(rd('src/pages/opportunities/[slug].astro')) && /Enquire about this \{noun\}/.test(rd('src/pages/opportunities/[slug].astro')));

  section('portfolio: the publication job');
  const job = rd('scripts/listings-publish-job.mjs');
  t('a portfolio request skips Notion, keeps the declaration check and the one-file pull request, and reuses the shared proof', /payload\.listingType === 'portfolio'\) return portfolioPublication/.test(job) && /async function portfolioPublication/.test(job) && /proveAndPublish\(\{ action, payload, checks, resumed, restoring/.test(job) && /verifyDeclaration\(payload, mode\)/.test(job.slice(job.indexOf('async function portfolioPublication'), job.indexOf('async function main')))
    && !/NotionReadClient|queryAll/.test(job.slice(job.indexOf('async function portfolioPublication'), job.indexOf('async function main'))));
  t('withdrawal and restoration are the same file-level operations: the tombstone is by id, and a restore lifts it only when the signed request says so', /const restoring = restoreRequested && isWithdrawn/.test(job) && /if \(isWithdrawn && !restoring\) await refuse\('withdrawn'/.test(job));
}
