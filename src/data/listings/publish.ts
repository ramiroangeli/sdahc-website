import { checkPublicSafety, PublicSafetyError, type SafetyContext } from './guards';
import {
  publicListingSchema,
  type ApprovedSnapshot,
  type ListingRecord,
  type PublicListing,
} from './schema';
import { contentHash, resolveListing } from './versioning';

/*
  Pure assembly of the public list: records + approved snapshots in, PublicListing[] out. No file or
  network access here, so the whole publication path can be exercised by tests.
*/

const summarise = (paragraph: string): string => {
  const flat = paragraph.replace(/\s+/g, ' ').trim();
  if (flat.length <= 200) return flat;
  const cut = flat.slice(0, 200);
  return `${cut.slice(0, cut.lastIndexOf(' '))}...`;
};

export interface BuildInput {
  records: ListingRecord[];
  snapshots: ApprovedSnapshot[];
  now: Date;
  ctx: SafetyContext;
  /** Ids with an explicit withdrawal (tombstone). Hidden regardless of status. */
  withdrawn?: ReadonlySet<string>;
}

export const buildPublicListings = ({ records, snapshots, now, ctx, withdrawn }: BuildInput): PublicListing[] => {
  const byId = new Map(snapshots.map((s) => [s.listingId, s]));
  const slugs = new Set<string>();
  const out: PublicListing[] = [];
  for (const r of records) {
    const snapshot = byId.get(r.id);
    const res = resolveListing({
      webStatus: r.webStatus,
      withdrawn: withdrawn?.has(r.id),
      listingEndDate: r.listingEndDate,
      snapshot,
      draftHash: r.draft ? contentHash(r.draft) : undefined,
      now,
    });
    if (!res.visible || !snapshot || !res.commercialStatus) continue;

    // The published content is always re-checked at build time, even though it was checked when approved.
    const issues = checkPublicSafety(snapshot.content, { ...ctx, internalAddress: r.internal.address, internalPriceAud: r.internal.priceAud, internalYieldPct: r.internal.yieldPct, allowDemo: ctx.allowDemo && r.isFixture });
    if (issues.length) throw new PublicSafetyError([`listing ${r.id}`, ...issues]);

    if (slugs.has(snapshot.content.slug)) throw new Error(`Duplicate listing slug: ${snapshot.content.slug}`);
    slugs.add(snapshot.content.slug);

    out.push(publicListingSchema.parse({
      ...snapshot.content,
      id: r.id,
      summary: summarise(snapshot.content.description[0]),
      commercialStatus: res.commercialStatus,
      featured: r.featured,
      version: snapshot.version,
      publishedAt: snapshot.firstPublishedAt,
      updatedAt: snapshot.approvedAt,
      isDemo: r.isFixture,
    }));
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title));
};

/** Fixtures may exist in development and previews, never in a production deployment. */
export const assertFixturesAllowed = (env: { VERCEL_ENV?: string }): void => {
  if (env.VERCEL_ENV === 'production') {
    throw new Error('Listing fixtures are enabled in a production deployment. Refusing to build.');
  }
};
