import { createHash } from 'node:crypto';
import { checkPublicSafety, type SafetyContext } from './guards';
import {
  LIVE_STATUSES,
  STATUS_TO_COMMERCIAL,
  isDemoPhoto,
  victorianClearance,
  publicContentSchema,
  type ApprovedSnapshot,
  type CommercialStatus,
  type ListingRecord,
  type PublicContent,
  type WebStatus,
} from './schema';

/*
  Versioning and approval.

  contentHash covers PublicContent only: the fields a visitor can see. Changing the CRM price, a deal
  stage or an internal note changes nothing here, so normal CRM work never touches a published page.
  Commercial status is deliberately outside the hash (see schema.ts).

  Rules, in order:
   - Withdrawn or Not Published hides a listing immediately, whatever else is true.
   - A listing is shown only from an approved snapshot whose hash verifies. Draft edits never show.
   - While a newer draft awaits approval, the last approved version stays live.
   - A snapshot is only ever created by validateForPublication() passing on an approved record.
*/

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
      : v;

export const stableStringify = (v: unknown): string => JSON.stringify(sortKeys(v));
export const contentHash = (c: PublicContent): string => createHash('sha256').update(stableStringify(c)).digest('hex');

export const isLiveStatus = (s: WebStatus): s is (typeof LIVE_STATUSES)[number] => (LIVE_STATUSES as readonly string[]).includes(s);

export interface Resolution {
  visible: boolean;
  reason: string;
  commercialStatus?: CommercialStatus;
  /** A draft exists that differs from the approved version and awaits approval. Internal signal only. */
  pendingChanges: boolean;
}

export const resolveListing = (i: {
  webStatus: WebStatus;
  /** An explicit tombstone: hides the listing whatever Notion says. */
  withdrawn?: boolean;
  listingEndDate?: string;
  snapshot?: ApprovedSnapshot;
  draftHash?: string;
  now: Date;
}): Resolution => {
  const hidden = (reason: string): Resolution => ({ visible: false, reason, pendingChanges: false });
  if (i.withdrawn) return hidden('explicitly withdrawn');
  if (i.webStatus === 'withdrawn') return hidden('withdrawn');
  if (i.webStatus === 'not_published') return hidden('not published');
  if (i.listingEndDate && new Date(i.listingEndDate) <= i.now) return hidden('listing end date has passed');
  const s = i.snapshot;
  if (!s) return hidden('no approved version exists');
  if (!s.approvedBy || !s.approvedAt) return hidden('approved version has no named approver');
  if (contentHash(s.content) !== s.contentHash) return hidden('approved version failed its integrity check');
  const commercialStatus = isLiveStatus(i.webStatus) ? STATUS_TO_COMMERCIAL[i.webStatus] : s.commercialStatus;
  const pending = i.draftHash !== undefined && i.draftHash !== s.contentHash;
  return {
    visible: true,
    reason: pending ? 'last approved version is live; a newer draft awaits approval' : 'live',
    commercialStatus,
    pendingChanges: pending,
  };
};

export interface PublicationCheck { ok: boolean; issues: string[]; content?: PublicContent }

/** Can this record be promoted to a new approved snapshot? Every minimum is enforced here. */
export const validateForPublication = (r: ListingRecord, ctx: SafetyContext, now: Date = new Date(), opts: { preflight?: boolean } = {}): PublicationCheck => {
  const issues: string[] = [];
  // preflight answers "would this pass once released?" for Draft, In Review and Approved rows
  if (!opts.preflight && !isLiveStatus(r.webStatus)) issues.push(`Web Listing Status is "${r.webStatus}"; only Published, Under Offer or Sold can be promoted`);
  if (!r.approval.by && !r.approval.byUserId) issues.push('Web Approved By is empty');
  // A person field is editable by anyone with write access, so it is not authorisation on its own. The
  // approver's Notion user id must also be on the authorised list (approvers.json). Default deny.
  if (!r.isFixture) {
    const allowed = ctx.authorisedApproverIds ?? [];
    if (!allowed.length) issues.push('no authorised approvers are configured (src/data/listings/approvers.json is empty)');
    else if (!r.approval.byUserId) issues.push('Web Approved By has no verifiable Notion user id; it must be a person property');
    else if (!allowed.includes(r.approval.byUserId)) issues.push('Web Approved By is not an authorised approver');
  }
  if (!r.approval.at) issues.push('Web Approved At is empty');
  else if (new Date(r.approval.at) > now) issues.push('Web Approved At is in the future');
  if (!r.draft) {
    issues.push('there is no valid public draft');
    return { ok: false, issues };
  }
  const parsed = publicContentSchema.safeParse(r.draft);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push(`${i.path.join('.') || 'content'}: ${i.message}`);
    return { ok: false, issues };
  }
  const c = parsed.data;
  if (!r.isFixture) {
    // Victoria: the price display and listing rules took effect on 1 October 2026 and their application to SDA
    // sales is not yet classified. Each pricing mode needs a recorded clearance (compliance.json).
    if (c.address.state === 'VIC' && !victorianClearance(ctx.compliance, r.id, c.pricing.mode).cleared) {
      issues.push(`Victorian pricing compliance is not cleared for "${c.pricing.mode}" (docs/victorian-pricing-compliance.md)`);
    }
    // Basic is real SDA design category for existing stock; it needs its classification validated first
    if (c.sda.designCategories?.includes('Basic') && !ctx.compliance?.basicClassification.confirmedListingIds.includes(r.id)) {
      issues.push('Design Category Basic: the classification (existing or legacy SDA) has not been validated for this listing');
    }
    if (c.photos.length < 1) issues.push('at least one approved photograph is required');
    if (c.photos.some(isDemoPhoto)) issues.push('demo photographs cannot be published');
  }
  issues.push(...checkPublicSafety(c, { ...ctx, allowDemo: ctx.allowDemo && r.isFixture }));
  return { ok: issues.length === 0, issues, content: issues.length === 0 ? c : undefined };
};

/** Builds the next snapshot, or returns null when the draft equals the latest approved version. */
export const nextSnapshot = (r: ListingRecord, content: PublicContent, previous: ApprovedSnapshot | undefined, now: Date): ApprovedSnapshot | null => {
  const hash = contentHash(content);
  if (previous && previous.contentHash === hash) return null;
  return {
    listingId: r.id,
    version: (previous?.version ?? 0) + 1,
    approvedBy: r.approval.by ?? r.approval.byUserId!,
    ...(r.approval.byUserId ? { approvedById: r.approval.byUserId } : {}),
    approvedAt: r.approval.at ?? now.toISOString(),
    firstPublishedAt: previous?.firstPublishedAt ?? r.approval.at ?? now.toISOString(),
    commercialStatus: isLiveStatus(r.webStatus) ? STATUS_TO_COMMERCIAL[r.webStatus] : 'available',
    featured: r.featured,
    ...(r.listingEndDate ? { listingEndDate: r.listingEndDate } : {}),
    ...(r.sourceEditedAt ? { sourceEditedAt: r.sourceEditedAt } : {}),
    contentHash: hash,
    content,
  };
};
