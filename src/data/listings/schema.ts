import { z } from 'astro/zod';

/*
  Listing data model for /opportunities/ (v2).

  Three layers, deliberately separate:
    1. Internal data   ListingRecord.internal. The full CRM address, internal price and yield, the
                       SharePoint links and Deal relations. Never serialised to a page.
    2. Public draft    ListingRecord.draft. The Web* fields from Notion, being edited. Not live.
    3. Approved public ApprovedSnapshot.content. The last version a named person approved. This, and
                       only this, is what visitors see. Editing the draft never changes it.

  PublicContent is the allowlist: it is the exact set of fields that may ever reach a browser, and it
  is what the content hash covers. Commercial status (Available, Under offer, Sold) is a live human
  decision and sits outside the hash, so marking a property Under offer never needs a re-approval.
*/

/** Pages that live at /opportunities/<name>/ and so cannot be listing slugs. */
export const RESERVED_SLUGS: readonly string[] = ['off-market'];
export const STATES = ['QLD', 'VIC', 'SA', 'NSW', 'WA', 'ACT', 'TAS', 'NT'] as const;
// Basic is a real SDA design category for existing (legacy) stock. It is NOT a new-build certification and
// is never treated as one: a listing with Basic needs its classification validated before it can be proposed.
export const DESIGN_CATEGORIES = ['HPS', 'IL', 'Robust', 'FA', 'Basic'] as const;
export const LISTING_TYPES = ['property', 'portfolio'] as const;
// Mirrors the Notion select "Web Listing Status". The default (empty) is not_published.
// Draft -> In Review -> Approved -> Published -> Under Offer -> Sold / Withdrawn. Only the last three
// live statuses make a listing visible; Approved means signed off and waiting for release.
export const WEB_STATUSES = ['not_published', 'draft', 'in_review', 'approved', 'published', 'under_offer', 'sold', 'withdrawn'] as const;
export const LIVE_STATUSES = ['published', 'under_offer', 'sold'] as const;
export const COMMERCIAL_STATUSES = ['available', 'under_offer', 'sold'] as const;
export const PRICING_MODES = ['asking_price', 'price_guide', 'eoi', 'contact_agent'] as const;
// Optional commercial facts. Lease status and occupancy status are different facts and are never treated as interchangeable:
// a property can be leased to a provider and still be partly or wholly unoccupied by participants.
export const LEASE_STATUSES = ['fully_leased', 'partially_leased', 'unleased'] as const;
export const OCCUPANCY_STATUSES = ['fully_occupied', 'partially_occupied', 'vacant'] as const;
export const INCOME_TYPES = ['gross', 'net'] as const;
export const FIGURE_BASES = ['actual', 'projected'] as const;
// Brand accents an image mask may use. Each maps to a design token in the components, so a
// colour sampled from a photograph can only ever become one of our own colours.
export const ACCENTS = ['blue', 'teal', 'amber', 'slate'] as const;

export type State = (typeof STATES)[number];
export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];
export type ListingType = (typeof LISTING_TYPES)[number];
export type WebStatus = (typeof WEB_STATUSES)[number];
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];
export type PricingMode = (typeof PRICING_MODES)[number];
export type Accent = (typeof ACCENTS)[number];

export const TYPE_LABEL: Record<ListingType, string> = { property: 'Individual property', portfolio: 'Portfolio' };
export const STATUS_LABEL: Record<CommercialStatus, string> = { available: 'Available', under_offer: 'Under offer', sold: 'Sold' };
export const DESIGN_LABEL: Record<DesignCategory, string> = {
  HPS: 'High Physical Support',
  IL: 'Improved Liveability',
  Robust: 'Robust',
  FA: 'Fully Accessible',
  Basic: 'Basic',
};
export const LEASE_LABEL: Record<(typeof LEASE_STATUSES)[number], string> = { fully_leased: 'Fully leased', partially_leased: 'Partially leased', unleased: 'Unleased' };
export const OCCUPANCY_LABEL: Record<(typeof OCCUPANCY_STATUSES)[number], string> = { fully_occupied: 'Fully occupied', partially_occupied: 'Partially occupied', vacant: 'Vacant' };
export const PRICING_MODE_LABEL: Record<PricingMode, string> = {
  asking_price: 'Asking Price',
  price_guide: 'Price Guide',
  eoi: 'Expressions of Interest',
  contact_agent: 'Contact Agent',
};
export const STATUS_TO_COMMERCIAL: Record<(typeof LIVE_STATUSES)[number], CommercialStatus> = {
  published: 'available',
  under_offer: 'under_offer',
  sold: 'sold',
};

/** "$695,000" or "$650,000 to $700,000". Canonical form only; see pricing.ts for normalisation. */
const AMOUNT = '\\$\\d{1,3}(?:,\\d{3})+';
export const PRICE_DISPLAY_RE = new RegExp(`^${AMOUNT}(?: to ${AMOUNT})?$`);

/**
 * The only address a visitor may ever see: street NAME, suburb, state, postcode. There is no field
 * for a house or unit number, so one cannot be serialised by accident. The CRM keeps the full address.
 */
export const publicAddressSchema = z.object({
  street: z.string().min(3).max(60)
    .regex(/^[^\d]+$/, 'street name must not contain digits')
    .refine((s) => !/\b(unit|lot|apt|apartment|flat|suite|level|shop)\b/i.test(s), 'street name must not carry a unit or lot'),
  suburb: z.string().min(2).max(60).regex(/^[^\d]+$/, 'suburb must not contain digits'),
  state: z.enum(STATES),
  postcode: z.string().regex(/^\d{4}$/),
}).strict();

export const pricingSchema = z.object({
  mode: z.enum(PRICING_MODES),
  /** Human-approved public amount in AUD. Required for asking_price and price_guide, forbidden otherwise. */
  display: z.string().regex(PRICE_DISPLAY_RE).optional(),
}).strict().superRefine((p, ctx) => {
  const needs = p.mode === 'asking_price' || p.mode === 'price_guide';
  if (needs && !p.display) ctx.addIssue({ code: 'custom', message: `${p.mode} requires an approved public amount` });
  if (!needs && p.display) ctx.addIssue({ code: 'custom', message: `${p.mode} must not carry an amount` });
});

const variantSchema = z.object({
  w: z.number().int().positive(),
  src: z.string().min(2),
}).strict();

const realPhotoSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{10,}$/),
  /** A description is optional for staff ("Kitchen" is enough). The published value is never empty: see fallbackAlt in notion.ts. */
  alt: z.string().min(1).max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  accent: z.enum(ACCENTS),
  /** A floorplan is a drawing, not a photograph: shown whole on a neutral ground. Absent means photograph. */
  kind: z.literal('floorplan').optional(),
  variants: z.array(variantSchema).min(1).max(6),
  /** A human confirmed no house number, letterbox, sign or person is identifiable in the frame. */
  privacyReviewed: z.literal(true),
}).strict();

/** Clearly labelled placeholder. Only ever valid in fixtures and development. */
const demoPhotoSchema = z.object({
  demo: z.literal(true),
  id: z.string().regex(/^demo-[a-z]+(-[a-z0-9]+)*$/),
  alt: z.string().min(8).max(200),
  accent: z.enum(ACCENTS),
}).strict();

export const photoSchema = z.union([realPhotoSchema, demoPhotoSchema]);

const sdaSchema = z.object({
  designCategories: z.array(z.enum(DESIGN_CATEGORIES)).max(5).optional(),
  buildingType: z.string().max(80).optional(),
  bedrooms: z.number().int().positive().optional(),
  residentPlaces: z.number().int().positive().optional(),
  /** Onsite Overnight Assistance, as approved public wording (for example "Onsite Overnight Assistance (OOA) available"). */
  ooa: z.string().min(2).max(120).optional(),
}).strict();

/** Optional physical facts. Bedrooms stay in `sda.bedrooms`. Every field is optional and nothing here is required to publish. */
export const propertySchema = z.object({
  bathrooms: z.number().int().min(1).max(20).optional(),
  carSpaces: z.number().int().min(0).max(20).optional(),
  floorAreaM2: z.number().positive().max(100000).optional(),
  landAreaM2: z.number().positive().max(10000000).optional(),
  parking: z.string().min(2).max(80).optional(),
  municipality: z.string().min(2).max(60).regex(/^[^\d]+$/, 'municipality must not contain digits').optional(),
}).strict();

/**
 * Optional commercial and tenancy facts. PRIVATE BY DEFAULT: this block exists only when a Publisher explicitly approved these exact values for
 * public advertising. `approval.valuesHash` is the hash of every other value in the block (see investment.ts), so changing any value without a fresh
 * approval makes the block invalid. The approver's identity is deliberately NOT here: it stays in the Listings Manager's private audit history.
 * A figure never appears without its basis (actual or projected) and its type (gross or net).
 */
export const investmentSchema = z.object({
  leaseStatus: z.enum(LEASE_STATUSES).optional(),
  occupancyStatus: z.enum(OCCUPANCY_STATUSES).optional(),
  tenure: z.string().min(2).max(120).optional(),
  annualIncomeAud: z.number().int().positive().max(100000000).optional(),
  incomeType: z.enum(INCOME_TYPES).optional(),
  yieldPct: z.number().positive().max(30).optional(),
  yieldType: z.enum(INCOME_TYPES).optional(),
  basis: z.enum(FIGURE_BASES).optional(),
  /** Provider arrangement wording. Only with a separate, explicit authorisation (approval.provider). */
  providerArrangement: z.string().min(2).max(200).optional(),
  approval: z.object({
    valuesHash: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z.literal(true).optional(),
  }).strict(),
}).strict().superRefine((v, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: 'custom', message });
  const figures = v.annualIncomeAud !== undefined || v.yieldPct !== undefined;
  if (v.annualIncomeAud !== undefined && !v.incomeType) add('annual income needs its type (gross or net)');
  if (v.yieldPct !== undefined && !v.yieldType) add('a yield needs its type (gross or net)');
  if (v.incomeType && v.annualIncomeAud === undefined) add('an income type without an income figure');
  if (v.yieldType && v.yieldPct === undefined) add('a yield type without a yield figure');
  if (figures && !v.basis) add('income and yield need their basis (actual or projected)');
  if (!figures && v.basis) add('a basis without any income or yield figure');
  if (v.yieldPct !== undefined && Math.abs(v.yieldPct * 10 - Math.round(v.yieldPct * 10)) > 1e-9) add('a yield has at most one decimal place');
  if (v.providerArrangement !== undefined && v.approval.provider !== true) add('provider arrangement wording needs its own explicit authorisation');
  const { approval: _a, ...rest } = v;
  if (Object.keys(rest).length === 0) add('an empty investment block');
});

/** Marketing agency, by key into src/data/agencies.json. Absent means SDA Home Choices. */
export const marketingSchema = z.object({
  agency: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
}).strict();
/** Everything approved for public display, and exactly what the content hash covers. */
export const publicContentSchema = z.object({
  slug: z.string().regex(/^[a-z]+(-[a-z]+)*$/, 'slug may contain letters and hyphens only').max(80)
    // a route that exists beside the listing pages under /opportunities/ can never be a listing's address
    .refine((s) => !RESERVED_SLUGS.includes(s), 'this slug is reserved for a page of the website'),
  type: z.enum(LISTING_TYPES),
  title: z.string().min(5).max(90),
  description: z.array(z.string().min(1).max(1200)).min(1).max(8),
  address: publicAddressSchema,
  pricing: pricingSchema,
  sda: sdaSchema,
  photos: z.array(photoSchema).max(24),
  // every group below is optional and absent from existing listings; an absent group is never serialised, so existing content hashes do not change
  property: propertySchema.optional(),
  investment: investmentSchema.optional(),
  marketing: marketingSchema.optional(),
}).strict();

/** The one shape pages and components consume. Strict: an unknown key fails the build. */
export const publicListingSchema = publicContentSchema.extend({
  id: z.string().regex(/^[a-z0-9_]+$/),
  summary: z.string().min(10).max(220),
  commercialStatus: z.enum(COMMERCIAL_STATUSES),
  featured: z.boolean(),
  version: z.number().int().positive(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  isDemo: z.boolean(),
  /** Local draft preview only (astro dev). Never present in a build. */
  isPreview: z.boolean().optional(),
}).strict();

export type PropertyFacts = z.infer<typeof propertySchema>;
export type Investment = z.infer<typeof investmentSchema>;
export type PublicAddress = z.infer<typeof publicAddressSchema>;
export type Pricing = z.infer<typeof pricingSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type PublicContent = z.infer<typeof publicContentSchema>;
export type PublicListing = z.infer<typeof publicListingSchema>;

export const isDemoPhoto = (p: Photo): p is z.infer<typeof demoPhotoSchema> => 'demo' in p;

/** Internal record. One row of the Notion Properties database, plus its public draft. */
export interface ListingRecord {
  /** Stable public id. Derived from the Notion page id by hashing; the raw id never leaves Notion. */
  id: string;
  webStatus: WebStatus;
  featured: boolean;
  listingEndDate?: string;
  /** Public draft built from the Web* fields. Null when absent or invalid. Never live by itself. */
  draft: PublicContent | null;
  /** by: display name; byUserId: the Notion user id, which is what authorisation is checked against. */
  approval: { by?: string; byUserId?: string; at?: string };
  /** Notion last_edited_time of the source row when this record was read. Traceability only. */
  sourceEditedAt?: string;
  isFixture: boolean;
  /** Internal only. Used by guards to detect leaks, and never copied anywhere public. */
  internal: {
    address?: string;
    priceAud?: number;
    yieldPct?: number;
    sharepointLink?: string;
    photoFolder?: string;
    dealIds?: string[];
    notionPageId?: string;
  };
}

/**
 * The last approved public version of a listing. Written only by the proposal step and merged through a
 * reviewed pull request, so git history is the audit trail. The site reads these files and never Notion.
 */
export interface ApprovedSnapshot {
  listingId: string;
  version: number;
  approvedBy: string;
  /** Notion user id of the approver, checked against src/data/listings/approvers.json at proposal time. */
  approvedById?: string;
  approvedAt: string;
  firstPublishedAt: string;
  commercialStatus: CommercialStatus;
  featured?: boolean;
  /** The listing stops being public on this date (UTC). Evaluated at build time, no Notion call. */
  listingEndDate?: string;
  /** Notion last_edited_time of the source row when the proposal was generated. */
  sourceEditedAt?: string;
  contentHash: string;
  content: PublicContent;
}

/**
 * Compliance clearances, kept in src/data/listings/compliance.json and changed only through a reviewed pull
 * request. Default deny: nothing is cleared until a named person records it after taking advice.
 */
export interface ComplianceConfig {
  victoria: {
    reviewedBy: string | null; reviewedAt: string | null; adviceReference: string | null; cleared: Record<PricingMode, boolean>;
    /**
     * Clearance with its basis stated. `listingId` names ONE listing, or is "*" for a standing determination that covers every listing for that
     * pricing mode (for example the business's position that its tenanted SDA investment sales are commercial sales). Both need the full record.
     */
    determinations?: VictorianDetermination[];
  };
  basicClassification: { confirmedListingIds: string[] };
}

/**
 * A recorded determination for a single listing, or for all listings when `listingId` is "*". `basis` is deliberately explicit: `internal_determination` is the
 * business's own reasoned position and is NOT legal advice or a ruling; `external_advice` cites advice from a
 * licensed adviser or the regulator. Every field is required, so a clearance always names who, when and why.
 */
export interface VictorianDetermination {
  listingId: string;
  pricingMode: PricingMode;
  basis: 'internal_determination' | 'external_advice';
  recordedBy: string;
  recordedAt: string;
  reference: string;
  statement: string;
  /**
   * Conditions the position relies on, checked by the publication engine on every listing that uses it, so the record cannot quietly stretch
   * beyond what it states. A condition this code does not recognise fails closed. Known: "sda_dwelling" (the listing carries an SDA design
   * category), "no_price_indication" (the public text never hints at a price, with words such as "offers over", "guide" or "reserve").
   */
  conditions?: string[];
}

/** Is this listing cleared for its pricing mode in Victoria? Mode-wide clearance, a complete standing determination ("*"), or a complete per-listing determination. */
export const victorianClearance = (c: ComplianceConfig | undefined, listingId: string, mode: PricingMode): { cleared: boolean; basis?: string; conditions?: string[] } => {
  if (!c) return { cleared: false };
  if (c.victoria.cleared[mode]) return { cleared: true, basis: 'mode-wide clearance' };
  const all = c.victoria.determinations ?? [];
  const d = all.find((x) => x.listingId === listingId && x.pricingMode === mode) ?? all.find((x) => x.listingId === '*' && x.pricingMode === mode);
  const complete = !!d && [d.recordedBy, d.recordedAt, d.reference, d.statement].every((v) => typeof v === 'string' && v.trim().length >= 3)
    && (d.basis === 'internal_determination' || d.basis === 'external_advice');
  return complete ? { cleared: true, basis: d!.listingId === '*' ? `standing ${d!.basis}` : d!.basis, conditions: d!.conditions ?? [] } : { cleared: false };
};

export interface Approver { notionUserId: string; name: string; githubHandle?: string }

/** An explicit withdrawal. Overrides everything, including a Published status in Notion. */
export interface Withdrawal { listingId: string; withdrawnAt: string; withdrawnBy: string; reason: string }
