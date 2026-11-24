// Slugs are permanent public addresses. Removing a doubled "NT" is cosmetic; what matters is that a slug is unique, stable and never taken from another listing, including a withdrawn one.
// Synthetic data only: nothing here reads a published listing.
import { loadTs } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const N = L.NOTION;
  const rt = (x) => ({ type: 'rich_text', rich_text: [{ plain_text: x }] }); const sel = (x) => ({ type: 'select', select: { name: x } });
  const page = (id, place, { state = 'NT', title = '' } = {}) => ({ id, last_edited_time: '2026-11-19T00:00:00.000Z', properties: { [N.name]: { type: 'title', title: [{ plain_text: 'Internal name' }] }, [N.state]: sel(state), [N.webStatus]: sel('Published'), [N.webPublicAddress]: rt(place), [N.webTitle]: rt(title), [N.webDescription]: rt('A home.'), [N.webPricingMode]: sel('Contact Agent') } });
  const slugOf = (id, place, taken = new Set(), opts = {}) => L.pageToRecord(page(id, place, opts), { photos: [], takenSlugs: taken, slug: opts.slug }).record.draft?.slug;
  const ID = (n) => `2e2909c1-0000-0000-0000-00000000d0${n}`;

  section('slugs: the state appears once, and uniqueness is separate from that');
  t('"Greater Darwin" and "Greater Darwin NT" give the same base slug: the state is added once', slugOf(ID(1), 'Greater Darwin') === 'greater-darwin-nt' && slugOf(ID(1), 'Greater Darwin NT') === 'greater-darwin-nt');
  const first = slugOf(ID(1), 'Greater Darwin');
  const second = slugOf(ID(2), 'Greater Darwin NT', new Set([first]));
  t('a second listing with the same public location gets a stable, readable suffix, never the first one\'s slug', second !== first && /^greater-darwin-nt-[a-z]{4}$/.test(second) && second === slugOf(ID(2), 'Greater Darwin NT', new Set([first])));
  t('a different listing id gives a different suffix, so many listings in one area never collide', new Set([first, second, slugOf(ID(3), 'Greater Darwin', new Set([first, second])), slugOf(ID(4), 'Greater Darwin', new Set([first, second]))]).size === 4);
  t('slugs are letters and hyphens only (no house number, digit or postcode can reach an address)', [first, second, slugOf(ID(5), 'Berrimah NT 0832'), slugOf(ID(6), 'Whipray Circuit, Berrimah NT 0832')].every((s) => /^[a-z]+(-[a-z]+)*$/.test(s)));

  section('slugs: published addresses are kept');
  t('an update never changes the slug, even when the title and the public location are edited afterwards', slugOf(ID(1), 'Alice Springs', new Set(), { title: 'A completely different title', slug: 'greater-darwin-nt' }) === 'greater-darwin-nt');
  t('a withdrawn listing keeps its slug reserved (its snapshot stays), so a new listing can never take it; republishing the same listing gets it back', slugOf(ID(7), 'Greater Darwin', new Set(['greater-darwin-nt'])) !== 'greater-darwin-nt' && slugOf(ID(1), 'Greater Darwin', new Set(), { slug: 'greater-darwin-nt' }) === 'greater-darwin-nt');
  t('the old doubled slug of an existing listing is left alone (not changed for looks) and does not collide with the corrected form', slugOf(ID(8), 'Greater Darwin NT', new Set(['greater-darwin-nt-nt'])) === 'greater-darwin-nt');

  section('slugs: individuals and portfolios share one namespace');
  t('a portfolio slug comes from its title (letters only, "portfolio" in it) and cannot equal an individual slug', L.portfolioSlug('Greater Darwin NT') === 'greater-darwin-nt-portfolio' && L.portfolioSlug('Greater Darwin NT') !== first);
  const pf = { publicId: 'lst_a1b2c3d4e5', status: 'available', request: { title: 'Greater Darwin NT', description: 'A portfolio.', coverage: 'Greater Darwin', states: ['NT'], propertyCount: 3, saleMode: 'both', pricingMode: 'contact_agent', displayPrice: null }, photos: [], previous: null, ctx: { allowDemo: true }, compliance: undefined };
  t('a portfolio whose address is already taken is refused with a plain reason (change the title), never silently given another listing\'s address', L.buildPortfolioContent({ ...pf, otherSlugs: new Set(['greater-darwin-nt-portfolio']) }).issues.some((i) => /another listing already uses the web address/.test(i)));
  t('reserved pages can never be a listing slug', L.portfolioSlug('Off market') !== 'off-market' && !L.RESERVED_SLUGS.includes(first));
}
