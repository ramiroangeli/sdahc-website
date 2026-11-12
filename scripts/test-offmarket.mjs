// Off-market page, the split of /opportunities/, and the Listings dropdown. Source-level checks; the built output is verified separately (see PR).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const list = rd('src/pages/opportunities.astro');
  const off = rd('src/pages/opportunities/off-market.astro');
  const nav = rd('src/components/Nav.astro');
  const panel = rd('src/components/ConfidentialAccessPanel.astro');

  section('off-market page: content moved, not duplicated');
  t('the route /opportunities/off-market/ exists as its own page', existsSync(join(repoRoot, 'src/pages/opportunities/off-market.astro')));
  const moved = ['Why off-market', 'A curated, confidential market', 'How access works', 'Register your interest', 'data-endpoint="/api/opportunities/"', 'Send enquiry', 'opp-img-row', 'Submit an EOI'];
  t('every moved piece is on the Off-market page', moved.every((x) => off.includes(x)));
  t('none of it remains on the Public Listings page', moved.every((x) => !list.includes(x)));
  t('the form still posts to the same endpoint and keeps its fields and anti-spam trap', /data-endpoint="\/api\/opportunities\/"/.test(off) && ['name="enquiryType"', 'name="name"', 'name="email"', 'name="phone"', 'name="message"', 'name="company"'].every((x) => off.includes(x)) && /fetch\(form\.dataset\.endpoint/.test(off));
  t('the Public Listings page ends with the eight-jurisdiction section, then the footer (nothing after it)', /opp-states-note[\s\S]*<\/section>\s*<\/div>\s*<\/BaseLayout>/.test(list) && list.indexOf('opp-states-band') > list.indexOf('<HeroCardFan'));
  t('order on Public Listings: hero, catalogue, animated fan, then the jurisdiction section', (() => { const i = (s) => list.indexOf(s); return i('<OpportunitiesHero') < i('<ListingsCatalogue') && i('<ListingsCatalogue') < i('<HeroCardFan') && i('<HeroCardFan') < i('opp-states-band'); })());
  t('the Confidential Access panel links to the Off-market page, and so does the empty-catalogue message', /class="btn cap-cta" href="\/opportunities\/off-market\/"/.test(panel) && /href="\/opportunities\/off-market\/">access off-market opportunities/.test(rd('src/components/ListingsCatalogue.astro')));
  t('no link on the catalogue still points at the removed #access anchor', !/href="#access"/.test(rd('src/components/ListingsCatalogue.astro') + panel + list));

  section('off-market page: search and structure');
  t('it has its own title, meta description and breadcrumbs (canonical and og:url come from the layout)', /title="Off-Market SDA Investment Opportunities \| SDA Home Choices"/.test(off) && /description="Access confidential off-market/.test(off) && /breadcrumbs=\{\[\{ name: 'Opportunities', path: '\/opportunities\/' \}, \{ name: 'Off-market', path: '\/opportunities\/off-market\/' \}\]\}/.test(off));
  t('one H1 from the shared hero, with its own title lines', /<OpportunitiesHero line1="Off-market" line2="Opportunities"/.test(off) && (rd('src/components/OpportunitiesHero.astro').match(/<h1/g) || []).length === 1);
  t('relevant internal links with descriptive anchors, all to real pages', ['/opportunities/', '/sda-property-and-portfolio-sales/', '/research/sda-market-report-2026/'].every((h) => off.includes(`href="${h}"`) && existsSync(join(repoRoot, 'src/pages', h.replace(/^\//, '').replace(/\/$/, '') + '.astro')) || existsSync(join(repoRoot, 'src/pages', h.replace(/^\//, '') + 'index.astro'))));
  t('the sitemap date and llms.txt know about the new page', /"\/opportunities\/off-market\/":/.test(rd('src/data/page-dates.json')) && /opportunities\/off-market\/\)/.test(rd('public/llms.txt')));
  t('robots.txt is unchanged (no new disallow, no crawler policy change)', rd('public/robots.txt') === 'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://sdahomechoices.com.au/sitemap-index.xml\n');

  section('off-market page: a listing can never take its address');
  const base = JSON.parse(rd('src/data/listings/approved/whipray-circuit-berrimah-nt.json')).content;
  t('a listing slug of "off-market" is refused; a normal slug is unchanged', !L.publicContentSchema.safeParse({ ...base, slug: 'off-market' }).success && L.publicContentSchema.safeParse(base).success && L.RESERVED_SLUGS.includes('off-market'));

  section('navigation: Listings dropdown');
  t('Listings is a button that controls a menu with exactly two links', /<button type="button" class="l dd-btn" aria-expanded="false" aria-controls="dd-listings" aria-haspopup="true">Listings/.test(nav) && (nav.match(/<ul class="dd-menu" id="dd-listings">[\s\S]*?<\/ul>/)[0].match(/<a /g) || []).length === 2);
  t('the links are Public Listings to /opportunities/ and Off-market Listings to /opportunities/off-market/', /<li><a href="\/opportunities\/">Public Listings<\/a><\/li>/.test(nav) && /<li><a href="\/opportunities\/off-market\/">Off-market Listings<\/a><\/li>/.test(nav));
  t('keyboard: Enter or Space (native button), ArrowDown and ArrowUp move through links, Escape closes and returns focus, focus leaving closes it', /e\.key === 'ArrowDown'/.test(nav) && /e\.key === 'ArrowUp'/.test(nav) && /e\.key === 'Escape' && dd\.classList\.contains\('is-open'\)/.test(nav) && /ddBtn\.focus\(\)/.test(nav) && /addEventListener\('focusout'/.test(nav));
  t('regression (found in a real-browser test): a menu opened by hovering stays open when the button is clicked', /let byHover = false;/.test(nav) && /if \(byHover\) \{ byHover = false; setDd\(true\); \} else setDd\(!dd\.classList\.contains\('is-open'\)\)/.test(nav) && /mouseenter', \(\) => \{ if \(!dd\.classList\.contains\('is-open'\)\) byHover = true; setDd\(true\); \}/.test(nav));
  t('regression (found in a real-browser test): ArrowDown from the button lands on the first link, decided by the key target not the focused element', /links\.includes\(e\.target\)/.test(nav) && !/links\.includes\(document\.activeElement\)/.test(nav) && /ddBtn\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'ArrowDown'\) \{ e\.preventDefault\(\); setDd\(true\); links\[0\]\.focus\(\); \} \}\);/.test(nav));
  t('aria-expanded follows the open state', /ddBtn\.setAttribute\('aria-expanded', String\(open\)\)/.test(nav));
  t('without JavaScript the menu still opens on hover and keyboard focus (CSS)', /\.nav-dd:not\(\[data-js\]\):hover \.dd-menu,\.nav-dd:not\(\[data-js\]\):focus-within \.dd-menu/.test(nav));
  t('phone menu: both pages are listed under a Listings label, always visible', /<p class="mm-group" id="mm-listings">Listings<\/p>/.test(nav) && /<a class="mm-sub" href="\/opportunities\/"[^>]*>Public Listings<\/a>/.test(nav) && /<a class="mm-sub" href="\/opportunities\/off-market\/"[^>]*>Off-market Listings<\/a>/.test(nav));
  t('one navigation component serves every page (homepage included): the layout is the only place it is used', /import Nav from '\.\.\/components\/Nav\.astro'/.test(rd('src/layouts/BaseLayout.astro')) && !/class="nls"/.test(rd('src/pages/index.astro')));
  t('the old top-level Listings link is gone', !/<a class="l" href="\/opportunities\/">Listings<\/a>/.test(nav));
}
