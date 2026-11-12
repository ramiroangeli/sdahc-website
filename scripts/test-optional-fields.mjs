// Optional listing data contract: physical facts, SDA facts, the approved commercial block (lease, occupancy, income, yield), the marketing agency.
// Everything here is synthetic except the three real approved files, which are only READ to prove they are unchanged by the contract.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const MEDIA = 'https://leojshpooxhtztim.public.blob.vercel-storage.com';
  const now = new Date('2026-11-12T00:00:00Z');
  const REAL = ['rutherford-grove-armstrong-creek-vic', 'sheppard-street-shepparton-vic', 'whipray-circuit-berrimah-nt'].map((s) => JSON.parse(rd(`src/data/listings/approved/${s}.json`)));
  const NT = REAL[2];
  let n = 0;
  const withHash = (inv, extra = {}) => ({ ...inv, approval: { valuesHash: L.investmentValuesHash({ ...inv, approval: { valuesHash: '0'.repeat(64) } }), ...extra } });
  /** one synthetic listing: { snapshot, record }. `state` overrides the address state; `mod` edits the content. */
  const listing = ({ state, status = 'available', type, mod, inv, extra } = {}) => {
    n += 1;
    const id = `lst_${String(n).padStart(10, '0')}`;
    const c = structuredClone(NT.content);
    c.slug = `synthetic-${'abcdefghijklmnopqrstuvwxyz'[n % 26]}${'abcdefghijklmnopqrstuvwxyz'[(n * 7) % 26]}${'abcdefghijklmnopqrstuvwxyz'[(n * 11) % 26]}-nt`;
    c.title = 'Synthetic Street, Darwin NT 0800';
    c.address = { street: 'Synthetic Street', suburb: 'Darwin', state: state ?? 'NT', postcode: '0800' };
    if (type) c.type = type;
    if (inv) c.investment = inv;
    if (extra) Object.assign(c, extra);
    if (mod) mod(c);
    const snapshot = { listingId: id, version: 1, approvedBy: 'SDA Home Choices', approvedById: 'listings-manager', approvedAt: '2026-11-10T00:00:00Z', firstPublishedAt: '2026-11-10T00:00:00Z', commercialStatus: status, contentHash: L.contentHash(c), content: c };
    const record = { id, webStatus: status === 'available' ? 'published' : status, featured: false, draft: null, approval: { by: 'SDA Home Choices', at: '2026-11-10T00:00:00Z' }, isFixture: false, internal: {} };
    return { id, c, snapshot, record };
  };
  const build = (ls, withdrawn) => L.buildPublicListings({ records: ls.map((x) => x.record), snapshots: ls.map((x) => x.snapshot), now, ctx: { allowDemo: false, mediaBaseUrl: MEDIA }, withdrawn: withdrawn ? new Set(withdrawn) : undefined });
  const safety = (c) => L.checkPublicSafety(c, { allowDemo: false, mediaBaseUrl: MEDIA });
  const view = (l, over = {}) => L.publicInvestment({ address: l.address, commercialStatus: l.commercialStatus, investment: l.investment, ...over });
  const FIG = { annualIncomeAud: 450000, incomeType: 'net', yieldPct: 11.1, yieldType: 'net', basis: 'actual' };

  section('optional data contract: backwards compatibility');
  for (const r of REAL) {
    const parsed = L.publicContentSchema.parse(r.content);
    t(`${r.content.slug}: still parses and the parse adds nothing`, JSON.stringify(parsed) === JSON.stringify(r.content) || L.contentHash(parsed) === r.contentHash);
    t(`${r.content.slug}: content hash unchanged (${r.contentHash.slice(0, 10)})`, L.contentHash(r.content) === r.contentHash && L.contentHash(parsed) === r.contentHash);
    t(`${r.content.slug}: still passes the safety checks`, safety(r.content).length === 0);
    t(`${r.content.slug}: carries none of the optional groups`, !('property' in r.content) && !('investment' in r.content) && !('marketing' in r.content));
  }
  {
    const built = L.buildPublicListings({ records: REAL.map((r) => ({ id: r.listingId, webStatus: 'published', featured: false, draft: null, approval: { by: r.approvedBy, at: r.approvedAt }, isFixture: false, internal: {} })), snapshots: REAL, now, ctx: { allowDemo: false, mediaBaseUrl: MEDIA } });
    t('the three real listings still build, in full, with no optional group', built.length === 3 && built.every((l) => !('property' in l) && !('investment' in l) && !('marketing' in l)));
    t('and the public view of their commercial block is empty', built.every((l) => L.publicInvestment(l) === null));
    t('and they resolve to the default agency', built.every((l) => L.agencyFor(l.marketing?.agency).key === 'sdahc'));
  }

  section('optional data contract: schema');
  const okc = (mod) => L.publicContentSchema.safeParse(listing({ mod }).c).success;
  t('every group is optional: a listing with no optional field is valid', okc(() => {}));
  t('physical facts validate', okc((c) => { c.property = { bathrooms: 2, carSpaces: 1, floorAreaM2: 148.5, landAreaM2: 612, parking: 'Double garage', municipality: 'City of Darwin' }; }));
  t('physical facts reject nonsense (zero bathrooms, a digit in the municipality, unknown key)', !okc((c) => { c.property = { bathrooms: 0 }; }) && !okc((c) => { c.property = { municipality: 'Council 12' }; }) && !okc((c) => { c.property = { price: 1 }; }));
  t('OOA wording is optional and bounded', okc((c) => { c.sda.ooa = 'Onsite Overnight Assistance (OOA) available'; }) && !okc((c) => { c.sda.ooa = 'x'.repeat(130); }));
  const inv = (o) => (c) => { c.investment = o; };
  t('a complete approved commercial block validates', okc(inv(withHash({ leaseStatus: 'fully_leased', occupancyStatus: 'fully_occupied', ...FIG }))));
  t('a block with only a lease status validates (nothing else is required)', okc(inv(withHash({ leaseStatus: 'fully_leased' }))));
  t('a block with only an occupancy status validates', okc(inv(withHash({ occupancyStatus: 'partially_occupied' }))));
  t('a block without an approval is refused by the schema', !okc(inv({ leaseStatus: 'fully_leased' })));
  t('income needs its type and a basis; yield needs its type and a basis', !okc(inv(withHash({ annualIncomeAud: 1000, basis: 'actual' }))) && !okc(inv(withHash({ yieldPct: 7, basis: 'actual' }))) && !okc(inv(withHash({ yieldPct: 7, yieldType: 'net' }))) && !okc(inv(withHash({ annualIncomeAud: 1000, incomeType: 'gross' }))));
  t('a basis or type with no figure is refused, and so is an empty block', !okc(inv(withHash({ basis: 'actual' }))) && !okc(inv(withHash({ yieldType: 'net' }))) && !okc(inv({ approval: { valuesHash: '0'.repeat(64) } })));
  t('a yield has one decimal place and a sane range', okc(inv(withHash({ ...FIG, yieldPct: 11.1 }))) && !okc(inv(withHash({ ...FIG, yieldPct: 11.123 }))) && !okc(inv(withHash({ ...FIG, yieldPct: 45 }))) && !okc(inv(withHash({ ...FIG, yieldPct: 0 }))));
  t('provider wording needs its own explicit authorisation', !okc(inv(withHash({ providerArrangement: 'Existing provider arrangement' }))) && okc(inv(withHash({ providerArrangement: 'Existing provider arrangement' }, { provider: true }))));
  t('the approval carries no identity: only a hash and an optional provider flag', !okc(inv({ leaseStatus: 'fully_leased', approval: { valuesHash: 'a'.repeat(64), by: 'x@y.com' } })) && !okc(inv({ leaseStatus: 'fully_leased', approval: { valuesHash: 'a'.repeat(64), at: '2026-11-12' } })));

  section('optional data contract: lease and occupancy are separate');
  {
    const base = (o) => listing({ inv: withHash(o) }).c;
    const lease = view(base({ leaseStatus: 'fully_leased' }));
    const occ = view(base({ occupancyStatus: 'partially_occupied' }));
    const both = view(base({ leaseStatus: 'fully_leased', occupancyStatus: 'vacant' }));
    t('lease only: shows the lease row and no occupancy row', lease.lease.label === 'Fully leased' && !('occupancy' in lease));
    t('occupancy only: shows the occupancy row and no lease row', occ.occupancy.label === 'Partially occupied' && !('lease' in occ));
    t('leased and vacant can both be true and are shown as two facts', both.lease.label === 'Fully leased' && both.occupancy.label === 'Vacant');
    t('the three lease labels and the three occupancy labels are exactly the approved wording', JSON.stringify(Object.values(L.LEASE_LABEL)) === JSON.stringify(['Fully leased', 'Partially leased', 'Unleased']) && JSON.stringify(Object.values(L.OCCUPANCY_LABEL)) === JSON.stringify(['Fully occupied', 'Partially occupied', 'Vacant']));
    t('nothing is inferred: a lease does not produce an occupancy and provider wording is not implied', !('occupancy' in lease) && !('provider' in lease));
  }

  section('optional data contract: approval is bound to the exact values');
  {
    const good = listing({ inv: withHash({ leaseStatus: 'fully_leased', ...FIG }) });
    t('approved figures pass the safety checks and build', safety(good.c).length === 0 && build([good]).length === 1);
    const v = view(build([good])[0]);
    t('the net yield shows as 11.1% with its type and basis', v.yield.text === '11.1%' && v.yield.label === 'Net yield' && v.yield.basis === 'Actual');
    t('the income shows with its type and basis', v.income.amountAud === 450000 && v.income.label === 'Net annual income' && v.income.basis === 'Actual');
    t('a projected figure is labelled Projected', view(listing({ inv: withHash({ ...FIG, basis: 'projected' }) }).c).yield.basis === 'Projected');
    const tampered = structuredClone(good.c); tampered.investment.yieldPct = 14.0;
    t('changing a value after approval invalidates it (safety check names it)', safety(tampered).some((m) => /not approved for public display, or were changed/.test(m)));
    t('and the build refuses it', (() => { try { build([listing({ inv: { ...withHash({ ...FIG }), yieldPct: 14.0 } })]); return false; } catch { return true; } })());
    t('a stale approval hash is never trusted by the view either', L.publicInvestment({ address: { state: 'NT' }, commercialStatus: 'available', investment: { ...withHash(FIG), yieldPct: 14.0 } }) === null);
    const tx = (o) => safety(listing({ inv: withHash({ leaseStatus: 'fully_leased', ...o }) }).c);
    t('free text in the block is still scanned: a dollar amount, an email and a link are refused', tx({ tenure: 'Lease at $1,200 per week' }).length > 0 && tx({ providerArrangement: 'Contact ops@example.com' }).length > 0 && tx({ tenure: 'See https://x.sharepoint.com/a' }).length > 0);
    t('plain tenure wording passes', tx({ tenure: 'Long-term lease to a registered SDA provider' }).length === 0);
  }

  section('optional data contract: Victorian restriction');
  {
    const vicFig = listing({ state: 'VIC', inv: withHash({ leaseStatus: 'fully_leased', ...FIG }) });
    t('income and yield on a Victorian listing are refused by the safety check', safety(vicFig.c).some((m) => /Victorian listings/.test(m)));
    t('and the build refuses it', (() => { try { build([vicFig]); return false; } catch { return true; } })());
    t('yield alone, or income alone, is also refused in Victoria', safety(listing({ state: 'VIC', inv: withHash({ yieldPct: 8.2, yieldType: 'gross', basis: 'projected' }) }).c).length > 0 && safety(listing({ state: 'VIC', inv: withHash({ annualIncomeAud: 300000, incomeType: 'gross', basis: 'projected' }) }).c).length > 0);
    const vicStatus = listing({ state: 'VIC', inv: withHash({ leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied' }) });
    const vb = build([vicStatus]);
    t('lease and occupancy alone remain allowed in Victoria when approved', vb.length === 1 && view(vb[0]).lease.label === 'Fully leased' && view(vb[0]).occupancy.label === 'Partially occupied');
    const bypass = view({ address: { state: 'VIC' }, commercialStatus: 'available', investment: withHash({ leaseStatus: 'fully_leased', ...FIG }) });
    t('defence in depth: even if figures reached the view in Victoria, none is shown', !('income' in bypass) && !('yield' in bypass) && bypass.lease.label === 'Fully leased');
    t('the restriction is not a legal determination and says so only as a restriction', /not published on Victorian listings until the advertising obligations are confirmed/.test(L.VICTORIAN_FINANCIAL_RESTRICTION));
    t('other states are unaffected (NT, QLD, NSW)', ['NT', 'QLD', 'NSW'].every((s) => safety(listing({ state: s, inv: withHash({ ...FIG }) }).c).length === 0));
  }

  section('optional data contract: statuses, portfolios, withdrawal');
  {
    const av = build([listing({ inv: withHash({ ...FIG }) })])[0];
    const uo = build([listing({ status: 'under_offer', inv: withHash({ ...FIG }) })])[0];
    const sold = build([listing({ status: 'sold', inv: withHash({ ...FIG }) })])[0];
    t('Available shows the commercial block; Under offer still shows it', !!view(av) && !!view(uo));
    t('Sold shows no commercial figures (a sold property is not offered)', view(sold) === null);
    const pf = build([listing({ type: 'portfolio', inv: withHash({ leaseStatus: 'partially_leased', ...FIG }) })])[0];
    t('a portfolio carries the same optional data', pf.type === 'portfolio' && view(pf).lease.label === 'Partially leased' && !!view(pf).yield);
    const w = listing({ inv: withHash({ ...FIG }) });
    t('a withdrawn listing does not build at all, so no figure can surface', build([w], [w.id]).length === 0);
  }

  section('optional data contract: privacy');
  {
    const p = build([listing({ inv: withHash({ leaseStatus: 'fully_leased', ...FIG }, {}), extra: { property: { bathrooms: 2 } } })])[0];
    const json = JSON.stringify(L.listingJsonLd(p, 'https://sdahomechoices.com.au'));
    t('the structured data built today carries no commercial figure, approval or hash', !/valuesHash|approval|450000|11\.1|annualIncome|yieldPct|leaseStatus|occupancyStatus|investment/.test(json));
    t('the view carries no approval, hash or identity', !/valuesHash|approval|@/.test(JSON.stringify(view(p))));
    t('the public listing keeps only the hash and the provider flag in the approval', JSON.stringify(Object.keys(p.investment.approval).sort()) === JSON.stringify(['valuesHash']));
    t('provider wording is shown only with its own authorisation', !('provider' in view(p)) && view(build([listing({ inv: withHash({ leaseStatus: 'fully_leased', providerArrangement: 'Existing SDA provider arrangement' }, { provider: true }) })])[0]).provider === 'Existing SDA provider arrangement');
  }

  section('optional data contract: marketing agency');
  {
    const files = L.AGENCIES.flatMap((a) => [a.logo, a.logoOnDark]);
    t('the registry holds SDA Home Choices and the files are real brand assets', L.AGENCIES.length === 1 && L.agencyFor().name === 'SDA Home Choices' && files.every((f) => existsSync(join(repoRoot, 'src/assets', f))));
    t('no agency means the default, an unknown key falls back to the default', L.agencyFor(undefined).key === 'sdahc' && L.agencyFor('nobody').key === 'sdahc');
    t('a listing naming the default agency is valid; an unregistered agency is refused', safety(listing({ extra: { marketing: { agency: 'sdahc' } } }).c).length === 0 && safety(listing({ extra: { marketing: { agency: 'other-agency' } } }).c).some((m) => /not an approved agency/.test(m)));
    t('the registry has no profile URL or contact data', !/https?:|@|phone|email|profile/i.test(rd('src/data/listings/agencies.json')));
  }
}
