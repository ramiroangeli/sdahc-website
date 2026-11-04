import { fetchManifest as defaultFetchManifest, manifestToPhotos, manifestUrlFor, pageToRecord, type MediaManifest, type NotionPage } from './notion';
import { isLiveStatus, nextSnapshot, validateForPublication } from './versioning';
import type { ApprovedSnapshot, ComplianceConfig, Photo } from './schema';

/*
  The proposal step: Notion rows in, proposed snapshots out. Pure apart from the manifest fetch, which is
  injected, so the whole decision logic is tested without a network or the file system.

  Nothing here publishes anything. A proposed snapshot becomes public only when a person reviews and
  merges the pull request that contains it. A row that fails any check yields NO snapshot, so a failed
  validation can never promote new content.
*/

export type ProposeKind = 'new' | 'version' | 'status' | 'unchanged' | 'withdrawn' | 'not_ready' | 'failed';
export interface ProposeAction {
  kind: ProposeKind;
  id: string;
  label: string;
  /** Present for new, version and status: the exact snapshot to write. */
  snapshot?: ApprovedSnapshot;
  issues: string[];
}

export interface ProposeInput {
  pages: NotionPage[];
  previous: ReadonlyMap<string, ApprovedSnapshot>;
  withdrawn: ReadonlySet<string>;
  /** Notion user ids allowed to approve. Empty means nobody (default deny). */
  approvers: string[];
  /** Compliance clearances. Omitted means nothing is cleared. */
  compliance?: ComplianceConfig;
  mediaBase: string;
  getManifest?: (url: string) => Promise<MediaManifest>;
  now?: Date;
}

const COMMERCIAL = { published: 'available', under_offer: 'under_offer', sold: 'sold' } as const;

export const propose = async (i: ProposeInput): Promise<ProposeAction[]> => {
  const now = i.now ?? new Date();
  const getManifest = i.getManifest ?? ((u: string) => defaultFetchManifest(u));
  const owner = new Map([...i.previous].map(([id, s]) => [s.content.slug, id]));
  const out: ProposeAction[] = [];

  for (const page of i.pages) {
    const first = pageToRecord(page);
    const rec0 = first.record;
    const live = isLiveStatus(rec0.webStatus);
    const preflightOnly = ['draft', 'in_review', 'approved'].includes(rec0.webStatus);
    if (!live && !preflightOnly) continue;
    const label = rec0.draft?.title ?? rec0.id;
    if (i.withdrawn.has(rec0.id)) { out.push({ kind: 'withdrawn', id: rec0.id, label, issues: ['an explicit withdrawal is in place'] }); continue; }

    const url = manifestUrlFor(rec0.id, i.mediaBase);
    let photos: Photo[] = [];
    const issues = [...first.issues];
    try {
      const r = manifestToPhotos(await getManifest(url), url, i.mediaBase);
      photos = r.photos;
      issues.push(...r.issues);
    } catch { issues.push(`no prepared photographs found at ${url}`); }

    const prev = i.previous.get(rec0.id);
    const taken = new Set([...owner.keys()].filter((sl) => sl !== prev?.content.slug));
    const { record } = pageToRecord(page, { photos, slug: prev?.content.slug, takenSlugs: taken, approvedAt: now.toISOString() });
    const check = validateForPublication(record, {
      internalAddress: record.internal.address, internalPriceAud: record.internal.priceAud, internalYieldPct: record.internal.yieldPct,
      mediaBaseUrl: i.mediaBase, allowDemo: false, authorisedApproverIds: i.approvers, compliance: i.compliance,
    }, now, { preflight: preflightOnly });
    for (const m of check.issues) if (!issues.includes(m)) issues.push(m);

    if (preflightOnly) { out.push({ kind: check.ok && !issues.length ? 'unchanged' : 'not_ready', id: record.id, label, issues }); continue; }
    if (!check.ok || !check.content) { out.push({ kind: 'failed', id: record.id, label, issues }); continue; }

    owner.set(check.content.slug, record.id);
    const next = nextSnapshot(record, check.content, prev, now);
    if (next) { out.push({ kind: prev ? 'version' : 'new', id: record.id, label, snapshot: next, issues: [] }); continue; }

    // same public content: only the commercial status, featured flag or end date may have moved
    const status = COMMERCIAL[record.webStatus as keyof typeof COMMERCIAL];
    const moved = prev!.commercialStatus !== status || (prev!.featured ?? false) !== record.featured || prev!.listingEndDate !== record.listingEndDate;
    if (moved) {
      const updated: ApprovedSnapshot = { ...prev!, commercialStatus: status, featured: record.featured, ...(record.listingEndDate ? { listingEndDate: record.listingEndDate } : {}) };
      out.push({ kind: 'status', id: record.id, label, snapshot: updated, issues: [] });
    } else out.push({ kind: 'unchanged', id: record.id, label, issues: [] });
  }
  return out;
};
