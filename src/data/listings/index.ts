import { FIXTURE_RECORDS, FIXTURE_SNAPSHOTS } from './fixtures';
import { assertFixturesAllowed, buildPublicListings } from './publish';
import { type ApprovedSnapshot, type ListingRecord, type PublicListing, type Withdrawal, type WebStatus } from './schema';

/*
  Loader for listings. The single entry point for every page and API route.

  The site reads ONLY local, committed files. It never contacts Notion, so an unrelated build does not
  depend on Notion being up, and a Notion outage or a failed sync can neither publish nor unpublish anything.
    approved/*.json    last approved public versions, added through a reviewed pull request
    withdrawn/*.json   explicit withdrawals; they override everything and are added the same way

  A listing's commercial status (Available, Under offer, Sold) is part of its approved snapshot, so a
  change of status is also a reviewed change. Fixtures are included in `astro dev`, or in a build run with
  LISTINGS_FIXTURES=1, and are otherwise dropped. A production deployment refuses to build with fixtures.
*/

const snapshotFiles = import.meta.glob<ApprovedSnapshot>('./approved/*.json', { eager: true, import: 'default' });
const withdrawalFiles = import.meta.glob<Withdrawal>('./withdrawn/*.json', { eager: true, import: 'default' });

const fixturesOn = () => import.meta.env.DEV || import.meta.env.LISTINGS_FIXTURES === '1';
const mediaBaseUrl = () => import.meta.env.LISTINGS_MEDIA_BASE_URL || undefined;

const COMMERCIAL_TO_LIVE: Record<ApprovedSnapshot['commercialStatus'], WebStatus> = { available: 'published', under_offer: 'under_offer', sold: 'sold' };

const load = (): { records: ListingRecord[]; snapshots: ApprovedSnapshot[]; allowDemo: boolean } => {
  if (fixturesOn()) {
    assertFixturesAllowed(process.env);
    return { records: FIXTURE_RECORDS, snapshots: FIXTURE_SNAPSHOTS, allowDemo: true };
  }
  const snapshots = Object.values(snapshotFiles);
  const records: ListingRecord[] = snapshots.map((s) => ({
    id: s.listingId,
    webStatus: COMMERCIAL_TO_LIVE[s.commercialStatus],
    featured: s.featured ?? false,
    listingEndDate: s.listingEndDate,
    draft: null,
    approval: { by: s.approvedBy, byUserId: s.approvedById, at: s.approvedAt },
    isFixture: false,
    internal: {},
  }));
  return { records, snapshots, allowDemo: false };
};

export const getPublicListings = (now: Date = new Date()): PublicListing[] => {
  const { records, snapshots, allowDemo } = load();
  const withdrawn = new Set(Object.values(withdrawalFiles).map((w) => w.listingId));
  return buildPublicListings({ records, snapshots, now, withdrawn, ctx: { allowDemo, mediaBaseUrl: mediaBaseUrl() } });
};

export const getListingBySlug = (slug: string) => getPublicListings().find((l) => l.slug === slug);
