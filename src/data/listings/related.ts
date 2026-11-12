import statesData from '../sda-states.json';
import type { PublicListing } from './schema';

/*
  Internal links and context for a listing page. Everything is derived from real, published, public sources:
   - related properties come only from the listings that are actually published (a withdrawn listing is not in that list) and never include a
     Sold property or the page's own listing;
   - market context quotes SDAHC Research's own figure for the listing's state from src/data/sda-states.json (the file behind the statistics page and
     the research map), with its source and date, and is labelled as general market information, never as a statement about the property;
   - links go only to pages that exist (checked by the test suite).
  No statistic is invented, no property performance, income, occupancy or demand claim is made, and nothing here varies by private data.
*/

/** The statistics source and as-at date the figures in sda-states.json carry (see /sda-statistics/). The test suite checks this against that page. */
export const MARKET_FIGURES_AS_AT = '31 March 2026';
export const MARKET_FIGURES_SOURCE = 'NDIA, Q3 2025-26; analysis: SDAHC Research';

/** Other published properties worth showing: same state or the same design category. Available and Under offer only. At most `max`, best match first. */
export const relatedListings = (listing: PublicListing, all: PublicListing[], max = 3): PublicListing[] => {
  const cats = new Set(listing.sda.designCategories ?? []);
  const scored = all
    .filter((o) => o.id !== listing.id && o.slug !== listing.slug && o.commercialStatus !== 'sold')
    .map((o) => ({
      o,
      score: (o.address.state === listing.address.state ? 4 : 0) + ((o.sda.designCategories ?? []).some((c) => cats.has(c)) ? 3 : 0) + (o.type === listing.type ? 1 : 0),
    }))
    // a property is related only if it shares the state or the design category (the type alone is not enough)
    .filter((x) => x.score >= 3);
  return scored
    .sort((a, b) => b.score - a.score || b.o.publishedAt.localeCompare(a.o.publishedAt) || a.o.slug.localeCompare(b.o.slug))
    .slice(0, max)
    .map((x) => x.o);
};

const STATE_PAGE: Record<string, string> = {
  VIC: '/research/sda-market-vic/', NSW: '/research/sda-market-nsw/', QLD: '/research/sda-market-qld/', SA: '/research/sda-market-sa/',
  WA: '/research/sda-market-wa/', TAS: '/research/sda-market-tas/', NT: '/research/sda-market-nt/', ACT: '/research/sda-market-act/',
};

export interface MarketContext {
  stateName: string;
  /** Enrolled SDA dwellings in the state and nationally, from SDAHC Research. */
  stateDwellings: string;
  nationalDwellings: string;
  asAt: string;
  source: string;
  statePage: string;
}
const fmt = (n: number) => n.toLocaleString('en-AU');
const STATES = statesData as Record<string, { name: string; d: number }>;

/** The verified market context for a listing's state, or null when there is none. */
export const marketContext = (listing: PublicListing): MarketContext | null => {
  const s = STATES[listing.address.state];
  const nat = STATES.NATIONAL;
  const statePage = STATE_PAGE[listing.address.state];
  if (!s || !nat || !statePage) return null;
  return { stateName: s.name, stateDwellings: fmt(s.d), nationalDwellings: fmt(nat.d), asAt: MARKET_FIGURES_AS_AT, source: MARKET_FIGURES_SOURCE, statePage };
};

export interface ResourceLink { href: string; text: string; note: string }

/** Relevant SDAHC pages for a buyer on a listing page. Descriptive anchors; every target is a real page. */
export const resourceLinks = (listing: PublicListing): ResourceLink[] => {
  const ctx = marketContext(listing);
  const links: ResourceLink[] = [];
  if (ctx) links.push({ href: ctx.statePage, text: `SDA market: ${ctx.stateName}`, note: 'Enrolled dwellings, participants and funding in the state.' });
  links.push(
    { href: '/research/sda-market-report-2026/', text: 'SDA Market Report 2026', note: '76 pages, free.' },
    { href: '/sda-statistics/', text: 'Australian SDA statistics', note: 'Reference figures, dated and defined.' },
    { href: '/opportunities/off-market/', text: 'Off-market SDA opportunities', note: 'Shared with qualified buyers under NDA.' },
    { href: '/sda-property-and-portfolio-sales/', text: 'SDA property and portfolio sales', note: 'How SDA Home Choices sells SDA property.' },
  );
  return links;
};
