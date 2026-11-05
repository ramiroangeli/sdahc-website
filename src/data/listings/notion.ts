import { createHash } from 'node:crypto';
import { AddressError, makeSlug, parsePublicAddress } from './address';
import { normalisePriceDisplay } from './pricing';
import { validateForPublication } from './versioning';
import {
  ACCENTS,
  PRICING_MODES,
  STATES,
  type Accent,
  type ComplianceConfig,
  type DesignCategory,
  type ListingRecord,
  type Photo,
  type PricingMode,
  type PublicContent,
  type WebStatus,
} from './schema';

/*
  Notion Properties database  ->  ListingRecord.

  READ ONLY by construction. NotionReadClient can query a data source, retrieve its schema and read one
  page; none of those writes. Nothing here can create, update or archive a Notion page.

  Verified against the Notion reference (query a data source, retrieve a data source, page property
  values, request limits): API version pinned to NOTION_VERSION; people values can be partial (an id with
  no name), so approvers are identified by Notion user id; a query can come back "incomplete" (capped at
  10,000 results) and that is treated as an error; data source queries are limited to about 3 per second,
  429 and 529 are retried after Retry-After. Mocked responses in the tests prove the mapping logic, not
  production compatibility: run `listings:schema` and `listings:preflight` against the real workspace.

  Which Notion fields feed the public draft is an explicit allowlist (see buildDraft). Everything
  else in the row (Price, Yield, Listing Agent, Sharepoint Link, Deals, Features ...) is read only
  into `internal`, where it is used to detect leaks and is never copied to a page.

  Property names below are the validated Properties database. The new Web* properties are specified in
  docs/opportunities-notion-integration.md and must be created in Notion before anything can publish:
  until then every row reads as "Not Published", which blocks publication by default.

  Only five Web* properties are essential. The slug, the approval time and the photo manifest location
  are DERIVED (see makeSlug, manifestUrlFor and the promotion step), so nobody types them.
*/

export const NOTION = {
  // existing fields
  name: 'Name',
  address: 'Address',
  price: 'Price',
  yield: 'Yield',
  description: 'Description',
  designCategory: 'Design Category',
  buildType: 'Build Type',
  features: 'Features',
  listingAgent: 'Listing Agent',
  listingDate: 'Listing Date',
  listingEndDate: 'Listing End Date',
  sharepointLink: 'Sharepoint Link',
  deals: 'Deals',
  state: 'State/ Territory',
  // new Web* properties. Required: status, public address, description, pricing mode, approver.
  webStatus: 'Web Listing Status',
  webPublicAddress: 'Web Public Address',
  webDescription: 'Web Description',
  webPricingMode: 'Web Pricing Mode',
  webApprovedBy: 'Web Approved By',
  // required only when the pricing mode is Asking Price or Price Guide
  webDisplayPrice: 'Web Display Price',
  // optional: a title defaults to "SDA property, <suburb>"; featured defaults to false; the folder is a
  // human pointer to the approved photos and is never read by the website
  webTitle: 'Web Title',
  webFeatured: 'Web Featured',
  webPhotoFolder: 'Web Photo Folder',
} as const;

/** Existing fields used to recognise the validated database and refuse a different "Properties" one. */
const CORE_FIELDS = [NOTION.name, NOTION.address, NOTION.price, NOTION.description, NOTION.designCategory, NOTION.deals, NOTION.state, NOTION.sharepointLink];
const WEB_REQUIRED = [NOTION.webStatus, NOTION.webPublicAddress, NOTION.webDescription, NOTION.webPricingMode, NOTION.webApprovedBy];
const WEB_CONDITIONAL = [NOTION.webDisplayPrice];
const WEB_OPTIONAL = [NOTION.webTitle, NOTION.webFeatured, NOTION.webPhotoFolder];
const WEB_FIELDS = [...WEB_REQUIRED, ...WEB_CONDITIONAL, ...WEB_OPTIONAL];

/* ---------- minimal Notion API shapes ---------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface NotionPage { id: string; properties: Record<string, any>; archived?: boolean; in_trash?: boolean; last_edited_time?: string }

const plain = (rt?: any[]) => (rt ?? []).map((t) => t?.plain_text ?? '').join('');

/** Reads any text-like property as a string. Unknown or empty properties read as "". */
export const readText = (p: any): string => {
  if (!p) return '';
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? '';
    case 'status': return p.status?.name ?? '';
    case 'multi_select': return (p.multi_select ?? []).map((o: any) => o.name).join(', ');
    case 'url': return p.url ?? '';
    case 'number': return p.number == null ? '' : String(p.number);
    case 'date': return p.date?.start ?? '';
    case 'people': return (p.people ?? []).map((u: any) => u.name).filter(Boolean).join(', ');
    case 'formula': return String(p.formula?.[p.formula?.type] ?? '');
    default: return '';
  }
};
export const readNumber = (p: any): number | undefined => (p?.type === 'number' && p.number != null ? p.number : undefined);
/** People values can be partial: always an id, sometimes no name. Authorisation uses the id. */
export const readPeople = (p: any): { id: string; name?: string }[] =>
  p?.type === 'people' ? (p.people ?? []).filter((u: any) => u?.id).map((u: any) => ({ id: u.id, ...(u.name ? { name: u.name } : {}) })) : [];
export const readCheckbox = (p: any): boolean => p?.type === 'checkbox' && p.checkbox === true;
export const readMulti = (p: any): string[] =>
  p?.type === 'multi_select' ? (p.multi_select ?? []).map((o: any) => o.name) : p?.type === 'select' && p.select ? [p.select.name] : [];
export const readRelationIds = (p: any): string[] => (p?.type === 'relation' ? (p.relation ?? []).map((r: any) => r.id) : []);

/* ---------- value mapping ---------- */

const STATUS_BY_LABEL: Record<string, WebStatus> = {
  'not published': 'not_published',
  draft: 'draft',
  'in review': 'in_review',
  approved: 'approved',
  published: 'published',
  'under offer': 'under_offer',
  sold: 'sold',
  withdrawn: 'withdrawn',
};

/** Empty or unrecognised means Not Published: the default blocks publication. */
export const mapWebStatus = (raw: string): { status: WebStatus; recognised: boolean } => {
  const s = STATUS_BY_LABEL[raw.trim().toLowerCase()];
  return s ? { status: s, recognised: true } : { status: 'not_published', recognised: raw.trim() === '' };
};

const DESIGN_BY_KEY: Record<string, DesignCategory> = {
  hps: 'HPS', highphysicalsupport: 'HPS',
  il: 'IL', improvedliveability: 'IL',
  r: 'Robust', robust: 'Robust',
  fa: 'FA', fullyaccessible: 'FA',
  basic: 'Basic',
};
export const mapDesignCategories = (raw: string[]): { values: DesignCategory[]; unknown: string[] } => {
  const values: DesignCategory[] = [];
  const unknown: string[] = [];
  for (const r of raw) {
    const k = r.toLowerCase().replace(/[^a-z]/g, '');
    const v = DESIGN_BY_KEY[k];
    if (v) { if (!values.includes(v)) values.push(v); }
    else unknown.push(r);
  }
  return { values, unknown };
};

const STATE_BY_NAME: Record<string, string> = {
  queensland: 'QLD', victoria: 'VIC', 'south australia': 'SA', 'new south wales': 'NSW',
  'western australia': 'WA', 'australian capital territory': 'ACT', tasmania: 'TAS', 'northern territory': 'NT',
};
const toStateCode = (raw: string): string | undefined => {
  const t = raw.trim();
  if (!t) return undefined;
  if ((STATES as readonly string[]).includes(t.toUpperCase())) return t.toUpperCase();
  return STATE_BY_NAME[t.toLowerCase()];
};

export const publicIdFor = (notionPageId: string): string => `lst_${createHash('sha256').update(notionPageId).digest('hex').slice(0, 10)}`;

/* ---------- media manifest (produced by scripts/prepare-listing-photos.mjs) ---------- */

export interface MediaManifest {
  version: 1;
  photos: {
    id: string; alt: string; width: number; height: number; accent: string; privacyReviewed: boolean;
    files: { w: number; file: string }[];
  }[];
}

/** Where a listing's prepared photos and manifest live: <media base>/<public id>/manifest.json. Derived, never typed. */
export const manifestUrlFor = (publicId: string, mediaBaseUrl: string): string => `${mediaBaseUrl.replace(/\/$/, '')}/${publicId}/manifest.json`;

export const manifestToPhotos = (m: MediaManifest, manifestUrl: string, mediaBaseUrl: string): { photos: Photo[]; issues: string[] } => {
  const issues: string[] = [];
  if (m?.version !== 1 || !Array.isArray(m.photos)) return { photos: [], issues: ['media manifest has an unexpected shape'] };
  const base = mediaBaseUrl.replace(/\/$/, '');
  const photos: Photo[] = [];
  for (const p of m.photos) {
    if (!p.privacyReviewed) { issues.push(`photo ${p.id}: privacy review (no house number, no identifiable person) not confirmed`); continue; }
    if (!p.alt || p.alt.trim().length < 8) { issues.push(`photo ${p.id}: alt text is missing`); continue; }
    if (!(ACCENTS as readonly string[]).includes(p.accent)) { issues.push(`photo ${p.id}: unknown accent "${p.accent}"`); continue; }
    const variants = p.files.map((f) => ({ w: f.w, src: new URL(f.file, manifestUrl).href }));
    if (variants.some((v) => !v.src.startsWith(`${base}/`))) { issues.push(`photo ${p.id}: file is not on the approved media origin`); continue; }
    photos.push({ id: p.id, alt: p.alt.trim(), width: p.width, height: p.height, accent: p.accent as Accent, variants, privacyReviewed: true } as Photo);
  }
  return { photos, issues };
};

/* ---------- page -> record ---------- */

export interface MapOptions {
  /** Photos resolved from the derived media manifest by the caller. Omit for status-only runs. */
  photos?: Photo[];
  /** The slug already frozen by a previous approved version. A published slug never changes. */
  slug?: string;
  /** Slugs already taken by other listings, so a same-street property gets a distinct slug. */
  takenSlugs?: ReadonlySet<string>;
  /** Set by the promotion step at the moment it promotes. Not read from Notion. */
  approvedAt?: string;
}
export interface MapResult { record: ListingRecord; issues: string[] }

const paragraphs = (raw: string) => raw.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** The allowlist: the only place a Notion value becomes public draft content. */
const buildDraft = (p: Record<string, any>, issues: string[], photos: Photo[], id: string, opts: MapOptions): PublicContent | null => {
  let address;
  try { address = parsePublicAddress(readText(p[NOTION.webPublicAddress])); } catch (e) {
    issues.push(e instanceof AddressError ? e.message : 'Web Public Address is invalid');
    return null;
  }
  const crmState = toStateCode(readText(p[NOTION.state]));
  if (crmState && crmState !== address.state) issues.push(`Web Public Address state ${address.state} disagrees with State/ Territory ${crmState}`);

  const mode = readText(p[NOTION.webPricingMode]).toLowerCase().replace(/[^a-z]/g, '');
  const modeMap: Record<string, PricingMode> = { askingprice: 'asking_price', priceguide: 'price_guide', expressionsofinterest: 'eoi', eoi: 'eoi', contactagent: 'contact_agent' };
  const pricingMode = modeMap[mode];
  if (!pricingMode || !(PRICING_MODES as readonly string[]).includes(pricingMode)) {
    issues.push('Web Pricing Mode is empty or unrecognised');
    return null;
  }
  let display: string | undefined;
  const rawDisplay = readText(p[NOTION.webDisplayPrice]);
  if (pricingMode === 'asking_price' || pricingMode === 'price_guide') {
    try { display = normalisePriceDisplay(rawDisplay); } catch (e) { issues.push((e as Error).message); return null; }
  } else if (rawDisplay.trim()) {
    issues.push(`Web Display Price is filled but Pricing Mode is ${pricingMode}; the amount would be ignored`);
  }

  const cats = mapDesignCategories(readMulti(p[NOTION.designCategory]));
  if (cats.unknown.length) issues.push(`Design Category value(s) not recognised: ${cats.unknown.join(', ')}`);

  const description = paragraphs(readText(p[NOTION.webDescription]));
  if (!description.length) issues.push('Web Description is empty');
  const title = readText(p[NOTION.webTitle]).trim() || `SDA property, ${address.suburb}`;
  // frozen once published, otherwise derived from the public address
  const slug = opts.slug ?? makeSlug(address, opts.takenSlugs ?? new Set(), id);
  const buildType = readText(p[NOTION.buildType]).trim();

  return {
    slug,
    type: 'property',
    title,
    description,
    address,
    pricing: display ? { mode: pricingMode, display } : { mode: pricingMode },
    sda: { ...(cats.values.length ? { designCategories: cats.values } : {}), ...(buildType ? { buildingType: buildType } : {}) },
    photos,
  };
};

export const pageToRecord = (page: NotionPage, opts: MapOptions = {}): MapResult => {
  const p = page.properties ?? {};
  const issues: string[] = [];
  const st = mapWebStatus(readText(p[NOTION.webStatus]));
  if (!st.recognised) issues.push(`Web Listing Status "${readText(p[NOTION.webStatus])}" is not recognised; treated as Not Published`);

  // archived or trashed pages are withdrawn, whatever their status says
  const gone = page.archived === true || page.in_trash === true;
  const webStatus: WebStatus = gone ? 'withdrawn' : st.status;

  const id = publicIdFor(page.id);
  const draft = st.status === 'not_published' && !gone ? null : buildDraft(p, issues, opts.photos ?? [], id, opts);

  const record: ListingRecord = {
    id,
    webStatus,
    featured: readCheckbox(p[NOTION.webFeatured]),
    listingEndDate: readText(p[NOTION.listingEndDate]) || undefined,
    draft,
    approval: (() => {
      const person = readPeople(p[NOTION.webApprovedBy])[0];
      return { by: person?.name ?? (readText(p[NOTION.webApprovedBy]) || undefined), byUserId: person?.id, at: opts.approvedAt };
    })(),
    sourceEditedAt: page.last_edited_time,
    isFixture: false,
    internal: {
      address: readText(p[NOTION.address]) || undefined,
      priceAud: readNumber(p[NOTION.price]),
      yieldPct: readNumber(p[NOTION.yield]),
      sharepointLink: readText(p[NOTION.sharepointLink]) || undefined,
      photoFolder: readText(p[NOTION.webPhotoFolder]) || undefined,
      dealIds: readRelationIds(p[NOTION.deals]),
      notionPageId: page.id,
    },
  };
  return { record, issues };
};

/** Does this look like the validated Properties database? Other databases are also called "Properties". */
export const checkSchema = (page: NotionPage | undefined): { isValidatedDatabase: boolean; missingCore: string[]; missingWeb: string[]; missingOptional: string[] } => {
  const keys = new Set(Object.keys(page?.properties ?? {}));
  const missingCore = CORE_FIELDS.filter((f) => !keys.has(f));
  // required and conditional Web properties; the website cannot publish anything until these exist
  const missingWeb = [...WEB_REQUIRED, ...WEB_CONDITIONAL].filter((f) => !keys.has(f));
  const missingOptional = WEB_OPTIONAL.filter((f) => !keys.has(f));
  return { isValidatedDatabase: missingCore.length <= 1, missingCore, missingWeb, missingOptional };
};

/**
 * Suggests the text for Web Public Address from the internal Address, by dropping the unit and house
 * number. It is only a suggestion printed for a person to paste: the website never uses it, it only ever
 * reads the explicit Web Public Address field.
 */
export const suggestPublicAddress = (internalAddress: string | undefined): string | undefined => {
  if (!internalAddress) return undefined;
  const m = /^\s*(?:(?:unit|apt|apartment)\s*)?(?:\d+[a-z]?\s*\/\s*)?\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+(.+)$/i.exec(internalAddress.trim());
  const candidate = (m ? m[1] : internalAddress).trim().replace(/\s+/g, ' ');
  try { const a = parsePublicAddress(candidate); return `${a.street}, ${a.suburb} ${a.state} ${a.postcode}`; } catch { return undefined; }
};

/* ---------- publication readiness report (used by the pilot preflight) ---------- */

export type ReadinessStatus = 'ready' | 'missing' | 'needs_approval' | 'protected' | 'info';
export interface ReadinessRow { item: string; status: ReadinessStatus; note: string }
export interface ReadinessReport { rows: ReadinessRow[]; canPublish: boolean; suggestedPublicAddress?: string }

/**
 * Answers, for one Properties row: what is ready for publication, what is missing, what needs an
 * explicit approval, and what is protected and will never be published. Read-only; takes a page already
 * fetched (or loaded from a file), so it can run without Notion credentials.
 */
const parseTry = (raw: string) => { try { return parsePublicAddress(raw); } catch { return undefined; } };

export const readinessReport = (page: NotionPage, o: { photos?: Photo[]; mediaBaseUrl?: string; now?: Date; authorisedApproverIds?: string[]; compliance?: ComplianceConfig } = {}): ReadinessReport => {
  const now = o.now ?? new Date();
  const p = page.properties ?? {};
  const rows: ReadinessRow[] = [];
  const add = (item: string, status: ReadinessStatus, note: string) => rows.push({ item, status, note });

  const schema = checkSchema(page);
  add('Validated Properties database', schema.isValidatedDatabase ? 'ready' : 'missing', schema.isValidatedDatabase ? 'Core fields recognised.' : `Missing core fields: ${schema.missingCore.join(', ')}. Wrong database?`);
  add('Web fields exist in Notion', schema.missingWeb.length ? 'missing' : 'ready', schema.missingWeb.length ? `Not yet created: ${schema.missingWeb.join(', ')}.` : 'All required Web properties present.');

  const internal = readText(p[NOTION.address]);
  const suggestion = suggestPublicAddress(internal);
  add('Internal Address', internal ? 'info' : 'missing', internal ? 'Kept complete and internal. Never published.' : 'Empty.');
  const publicAddr = readText(p[NOTION.webPublicAddress]);
  if (!publicAddr) add('Web Public Address', 'missing', suggestion ? `Empty. Suggested value to paste: "${suggestion}".` : 'Empty. Enter "Street Name, Suburb STATE 1234" without a house or unit number.');
  else { try { parsePublicAddress(publicAddr); add('Web Public Address', 'ready', publicAddr); } catch (e) { add('Web Public Address', 'missing', (e as Error).message); } }

  add('Web Description', readText(p[NOTION.webDescription]).trim() ? 'ready' : 'missing', readText(p[NOTION.webDescription]).trim() ? 'Present (public text, human written).' : 'Empty. Public copy must be written and approved; the CRM Description is never used.');
  const mode = readText(p[NOTION.webPricingMode]);
  add('Web Pricing Mode', mode ? 'ready' : 'missing', mode || 'Empty. Choose Asking Price, Price Guide, Expressions of Interest or Contact Agent.');
  const price = readNumber(p[NOTION.price]);
  const yld = readNumber(p[NOTION.yield]);
  add('Internal Price', price != null ? 'protected' : 'info', price != null ? 'Present. Never published automatically. Public pricing only through Web Pricing Mode and Web Display Price, individually approved.' : 'Empty.');
  add('Internal Yield', yld != null ? 'protected' : 'info', yld != null ? 'Present. Never published. Needs a specific public field and an explicit approval before any yield appears.' : 'Empty.');
  const cats = mapDesignCategories(readMulti(p[NOTION.designCategory]));
  add('Design Category', cats.unknown.length ? 'missing' : cats.values.length ? 'needs_approval' : 'info', cats.unknown.length ? `Not recognised: ${cats.unknown.join(', ')}.` : cats.values.length ? `${cats.values.join(', ')}: published as an SDA fact, so the approver confirms it.${cats.values.includes('Basic') ? ' Basic is existing (legacy) SDA stock: its classification must be validated and it is never described as a new build.' : ''}` : 'Empty: no category is shown.');
  add('Description (CRM)', readText(p[NOTION.description]).trim() ? 'protected' : 'info', 'Internal. May hold financial, occupancy, provider or other commercial detail. Never published; public copy comes only from Web Description.');
  add('Features', 'protected', 'Never published: may carry tenancy or occupancy detail.');
  add('Listing Agent', 'protected', 'Internal. Not published; enquiries go through the website form.');
  add('Sharepoint Link', readText(p[NOTION.sharepointLink]) ? 'protected' : 'info', 'Internal only. May hold IMs and tenancy documents; never public and never used as a gallery.');
  const st = mapWebStatus(readText(p[NOTION.webStatus]));
  add('Web Listing Status', st.status === 'not_published' ? 'info' : 'ready', st.status === 'not_published' ? 'Not Published (the default). Nothing can go live.' : st.status);
  const approver = readPeople(p[NOTION.webApprovedBy])[0];
  const allowed = o.authorisedApproverIds ?? [];
  add('Web Approved By', approver ? 'ready' : 'missing', approver ? `${approver.name ?? 'A person'} is named (Notion user id ${approver.id}).` : 'Empty. A named approver is mandatory.');
  add('Authorised approver', !approver ? 'missing' : !allowed.length ? 'missing' : allowed.includes(approver.id) ? 'ready' : 'missing', !approver ? 'No approver to check.' : !allowed.length ? 'No authorised approvers are configured (approvers.json is empty), so nothing can be approved.' : allowed.includes(approver.id) ? 'The named person is on the authorised approver list (checked by Notion user id).' : 'The named person is NOT on the authorised approver list. A person field is editable, so it is not authorisation on its own.');
  add('Approved photographs', o.photos?.length ? 'ready' : 'missing', o.photos?.length ? `${o.photos.length} approved photograph(s) with alt text and a recorded privacy review.` : 'None yet. Prepare and review real photographs; no placeholder is ever published.');

  const state = toStateCode(readText(p[NOTION.state])) ?? (parseTry(readText(p[NOTION.webPublicAddress]))?.state);
  const modeKey = ({ askingprice: 'asking_price', priceguide: 'price_guide', expressionsofinterest: 'eoi', eoi: 'eoi', contactagent: 'contact_agent' } as Record<string, PricingMode>)[readText(p[NOTION.webPricingMode]).toLowerCase().replace(/[^a-z]/g, '')];
  if (state === 'VIC') {
    const cleared = modeKey ? o.compliance?.victoria.cleared[modeKey] : false;
    add('Victorian pricing compliance', cleared ? 'ready' : 'missing', cleared ? `Cleared for ${modeKey}.` : `Not cleared${modeKey ? ` for ${modeKey}` : ''}. The Victorian rules in force from 1 October 2026 and their application to SDA sales need legal classification (docs/victorian-pricing-compliance.md), recorded in compliance.json.`);
  }
  if (cats.values.includes('Basic')) {
    const ok = o.compliance?.basicClassification.confirmedListingIds.includes(publicIdFor(page.id));
    add('Basic classification validated', ok ? 'ready' : 'missing', ok ? 'Validated for this listing.' : 'Not validated. Confirm the existing or legacy SDA classification before proposing (compliance.json).');
  }

  const mapped = pageToRecord(page, { photos: o.photos, approvedAt: now.toISOString() });
  const check = validateForPublication(mapped.record, { internalAddress: mapped.record.internal.address, internalPriceAud: mapped.record.internal.priceAud, internalYieldPct: mapped.record.internal.yieldPct, mediaBaseUrl: o.mediaBaseUrl, allowDemo: false, authorisedApproverIds: allowed, compliance: o.compliance }, now, { preflight: true });
  const blocking = [...new Set([...mapped.issues, ...check.issues])];
  add('Privacy and safety validation', blocking.length ? 'missing' : 'ready', blocking.length ? blocking.join('; ') : 'No house or unit number, no financial data, no private links, no personal data. All checks pass.');
  const canPublish = rows.every((r) => r.status !== 'missing');
  add('Final readiness', canPublish ? 'ready' : 'missing', canPublish ? 'Ready to be proposed for review. Nothing is published until a reviewed pull request is merged.' : 'Not ready. Resolve every MISSING item.');
  return { rows, canPublish, suggestedPublicAddress: suggestion };
};

/* ---------- schema verification (against the real data source, read only) ---------- */

/** Expected types of the existing CRM properties, as reported by the connector and confirmed by the team. */
export const EXPECTED_CORE_TYPES: Record<string, string> = {
  [NOTION.name]: 'title',
  [NOTION.address]: 'rich_text',
  [NOTION.price]: 'number',
  [NOTION.yield]: 'number',
  [NOTION.designCategory]: 'select',
  [NOTION.state]: 'select',
  [NOTION.features]: 'multi_select',
  [NOTION.description]: 'rich_text',
  [NOTION.sharepointLink]: 'url',
  [NOTION.listingAgent]: 'rich_text',
  [NOTION.listingDate]: 'date',
  [NOTION.listingEndDate]: 'date',
};

/**
 * Existing properties that are checked only when the integration can see them. A relation to another database
 * is hidden from an integration that has no access to that database, and the read-only integration must NOT be
 * given access to the Deals database (it holds financial deal data). Deals is never needed to publish.
 */
export const OPTIONAL_CORE_TYPES: Record<string, string> = { [NOTION.deals]: 'relation' };

export const WEB_STATUS_OPTIONS = ['Not Published', 'Draft', 'In Review', 'Approved', 'Published', 'Under Offer', 'Sold', 'Withdrawn'];
export const WEB_PRICING_OPTIONS = ['Asking Price', 'Price Guide', 'Expressions of Interest', 'Contact Agent'];

/** The exact Web properties to add. Types are final; select options are listed in order. */
export interface WebProperty {
  name: string;
  type: string;
  options?: string[];
  required: 'always' | 'conditional' | 'optional';
  /** What happens when the field is blank. */
  defaultBehaviour: string;
  /** Where the value lands in the public snapshot, or why it does not. */
  mapsTo: string;
  note: string;
}

export const WEB_SCHEMA: WebProperty[] = [
  { name: NOTION.webStatus, type: 'select', options: WEB_STATUS_OPTIONS, required: 'always', defaultBehaviour: 'Not Published. Blank or unrecognised also means Not Published, so nothing can go live.', mapsTo: 'Not stored. It is the visibility gate: Published, Under Offer and Sold set snapshot.commercialStatus (Available, Under offer, Sold); Draft, In Review and Approved are checked but never proposed; Withdrawn and Not Published are never proposed.', note: 'Default value: Not Published.' },
  { name: NOTION.webPublicAddress, type: 'rich_text', required: 'always', defaultBehaviour: 'Blank blocks publication.', mapsTo: 'content.address { street, suburb, state, postcode }. Also the source of the slug. There is no field for a house or unit number.', note: 'Street Name, Suburb STATE 1234. No house or unit number.' },
  { name: NOTION.webDescription, type: 'rich_text', required: 'always', defaultBehaviour: 'Blank blocks publication. The CRM Description is never used.', mapsTo: 'content.description[] (one entry per paragraph). The first paragraph becomes the summary shown on cards.', note: 'Public text only. Paragraphs separated by a blank line.' },
  { name: NOTION.webPricingMode, type: 'select', options: WEB_PRICING_OPTIONS, required: 'always', defaultBehaviour: 'Blank blocks publication.', mapsTo: 'content.pricing.mode (asking_price, price_guide, eoi, contact_agent).', note: 'No default.' },
  { name: NOTION.webApprovedBy, type: 'people', required: 'always', defaultBehaviour: 'Blank blocks publication. The person must also be on approvers.json (by Notion user id).', mapsTo: 'snapshot.approvedBy and snapshot.approvedById. Not shown on any page.', note: 'One authorised approver. Authorisation is verified by user id, not by this field alone.' },
  { name: NOTION.webDisplayPrice, type: 'number', required: 'conditional', defaultBehaviour: 'Blank is correct for EOI and Contact Agent. Required for Asking Price and Price Guide; filling it for the other two modes is reported and ignored.', mapsTo: 'content.pricing.display, formatted as "$695,000 AUD". Never copied from the CRM Price.', note: 'AUD. A single figure; a range needs a second field.' },
  { name: NOTION.webTitle, type: 'rich_text', required: 'optional', defaultBehaviour: 'Blank derives "SDA property, <suburb>".', mapsTo: 'content.title.', note: 'Maximum 90 characters.' },
  { name: NOTION.webFeatured, type: 'checkbox', required: 'optional', defaultBehaviour: 'Unchecked: not featured.', mapsTo: 'snapshot.featured (orders the hero cards).', note: 'Defaults to unchecked.' },
  { name: NOTION.webPhotoFolder, type: 'url', required: 'optional', defaultBehaviour: 'Blank is fine.', mapsTo: 'Not stored and never read by the website. A human pointer to the SharePoint "Approved for Website" folder.', note: 'Never read by the website.' },
];

export interface DataSourceSchema { properties: Record<string, { name?: string; type?: string; select?: { options?: { name: string }[] } }> }

export interface SchemaCheck {
  isValidatedDatabase: boolean;
  wrongCoreType: { name: string; expected: string; actual: string }[];
  missingCore: string[];
  /** Web properties still to be created, with their exact type and options. */
  toAdd: typeof WEB_SCHEMA;
  /** Web properties that exist with the wrong type. */
  wrongWebType: { name: string; expected: string; actual: string }[];
  missingSelectOptions: { name: string; missing: string[] }[];
  /** Design Category options with no SDA meaning, so they would be reported rather than published. */
  unmappedDesignOptions: string[];
  /** State/ Territory options that are not recognised state codes. */
  unmappedStateOptions: string[];
}

/** Compares a retrieved data source with what the adapter expects. Works whether the map is keyed by name or by id. */
export const checkDataSourceSchema = (ds: DataSourceSchema): SchemaCheck => {
  const byName = new Map(Object.entries(ds.properties ?? {}).map(([k, v]) => [v?.name ?? k, v]));
  const wrongCoreType: SchemaCheck['wrongCoreType'] = [];
  const missingCore: string[] = [];
  for (const [name, expected] of Object.entries(EXPECTED_CORE_TYPES)) {
    const got = byName.get(name);
    if (!got) missingCore.push(name);
    else if (got.type !== expected) wrongCoreType.push({ name, expected, actual: String(got.type) });
  }
  for (const [name, expected] of Object.entries(OPTIONAL_CORE_TYPES)) {
    const got = byName.get(name);
    if (got && got.type !== expected) wrongCoreType.push({ name, expected, actual: String(got.type) });
  }
  const toAdd: SchemaCheck['toAdd'] = [];
  const wrongWebType: SchemaCheck['wrongWebType'] = [];
  const missingSelectOptions: SchemaCheck['missingSelectOptions'] = [];
  for (const w of WEB_SCHEMA) {
    const got = byName.get(w.name);
    if (!got) { toAdd.push(w); continue; }
    if (got.type !== w.type) { wrongWebType.push({ name: w.name, expected: w.type, actual: String(got.type) }); continue; }
    if (w.options && got.type === 'select') {
      const have = new Set((got.select?.options ?? []).map((o) => o.name));
      const missing = w.options.filter((o) => !have.has(o));
      if (missing.length) missingSelectOptions.push({ name: w.name, missing });
    }
  }
  const optNames = (n: string) => (byName.get(n)?.select?.options ?? []).map((o) => o.name);
  const unmappedDesignOptions = optNames(NOTION.designCategory).filter((o) => !mapDesignCategories([o]).values.length);
  const unmappedStateOptions = optNames(NOTION.state).filter((o) => !toStateCode(o));
  return {
    isValidatedDatabase: missingCore.length === 0 && wrongCoreType.length === 0,
    wrongCoreType, missingCore, toAdd, wrongWebType, missingSelectOptions, unmappedDesignOptions, unmappedStateOptions,
  };
};

/* ---------- read-only client ---------- */

/** Pinned API version. Override with NOTION_API_VERSION only after re-running the schema and preflight checks. */
export const NOTION_VERSION = '2026-03-11';
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
/** The database (container) id. The REST API needs the DATA SOURCE id; this one would 404. */
export const KNOWN_DATABASE_ID = '2e2909c1-bb60-81b5-8806-ff710a8274ed';

export interface NotionConfig { token: string; dataSourceId: string; version: string; apiBase?: string }

/**
 * Accepts a bare UUID, or the "collection://<uuid>" form the connector shows, and returns the plain UUID.
 * The collection URI is never sent to the REST API. Anything that is not a UUID is rejected.
 */
export const normaliseNotionId = (raw: string): string => {
  const id = raw.trim().replace(/^collection:\/\//i, '');
  if (!UUID.test(id)) throw new Error('A Notion id must be a UUID (optionally written as collection://<uuid>)');
  return id;
};

export const readNotionConfig = (env: Record<string, string | undefined>): NotionConfig | null => {
  if (!env.NOTION_TOKEN || !env.NOTION_PROPERTIES_DATA_SOURCE_ID) return null;
  const dataSourceId = normaliseNotionId(env.NOTION_PROPERTIES_DATA_SOURCE_ID);
  if (dataSourceId.replace(/-/g, '').toLowerCase() === KNOWN_DATABASE_ID.replace(/-/g, '')) {
    throw new Error('NOTION_PROPERTIES_DATA_SOURCE_ID is set to the DATABASE id. Use the data source id from Notion (see docs/listings-runbook.md).');
  }
  // NOTION_API_BASE exists only so the CLI can be exercised against a local mock server. It must be a loopback
  // address, so a mistyped or malicious value can never redirect the token to another host.
  const base = env.NOTION_API_BASE;
  if (base && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(base)) {
    throw new Error('NOTION_API_BASE is for local tests only and must be http://127.0.0.1 or http://localhost');
  }
  return { token: env.NOTION_TOKEN, dataSourceId, version: env.NOTION_API_VERSION || NOTION_VERSION, ...(base ? { apiBase: base.replace(/\/$/, '') } : {}) };
};

/** Never carries headers, the token or the response body: only the status and Notion's error code. */
export class NotionApiError extends Error {
  constructor(public status: number, public code: string | undefined, what: string) {
    super(`Notion ${what} failed: HTTP ${status}${code ? ` (${code})` : ''}`);
  }
}

export interface ClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  /** Minimum gap between requests. Data source queries are limited to about 3 per second. */
  minIntervalMs?: number;
  now?: () => number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const MAX_PAGES = 200;

export class NotionReadClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;
  private minInterval: number;
  private now: () => number;
  private last = 0;

  constructor(private cfg: NotionConfig, o: ClientOptions = {}) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 4;
    this.minInterval = o.minIntervalMs ?? 350;
    this.now = o.now ?? Date.now;
  }

  private async request(method: 'GET' | 'POST', path: string, what: string, body?: unknown): Promise<any> {
    for (let attempt = 0; ; attempt += 1) {
      const wait = this.last + this.minInterval - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      const res = await this.fetchImpl(`${this.cfg.apiBase ?? 'https://api.notion.com'}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.cfg.token}`, 'Notion-Version': this.cfg.version, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.ok) return res.json();
      let code: string | undefined;
      try { code = ((await res.json()) as { code?: string }).code; } catch { /* non-JSON error body */ }
      // public_api_request_blocked will not succeed on retry; client errors are never retried
      if (!RETRYABLE.has(res.status) || code === 'public_api_request_blocked' || attempt >= this.maxRetries) {
        throw new NotionApiError(res.status, code, what);
      }
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await this.sleep(backoff);
    }
  }

  /** GET the integration's own bot user. Read only. It proves the token is accepted, and nothing more. */
  retrieveSelf(): Promise<{ object: string; type?: string }> {
    return this.request('GET', '/v1/users/me', 'token check');
  }

  /** GET the data source (its property schema). Read only. */
  retrieveDataSource(): Promise<DataSourceSchema> {
    return this.request('GET', `/v1/data_sources/${this.cfg.dataSourceId}`, 'data source retrieval');
  }

  /** Reads one page (GET). Used by the pilot preflight. */
  retrievePage(pageId: string): Promise<NotionPage> {
    return this.request('GET', `/v1/pages/${normaliseNotionId(pageId)}`, 'page retrieval');
  }

  /**
   * Queries every page of the data source (POST /query, which reads and never writes). Pagination is
   * followed to the end. A capped ("incomplete") result is an error, never a quiet truncation, because a
   * missing row could be a withdrawal. filter_properties limits each row to the named properties.
   */
  async queryAll(o: { filterProperties?: string[] } = {}): Promise<NotionPage[]> {
    const qs = (o.filterProperties ?? []).map((n) => `filter_properties=${encodeURIComponent(n)}`).join('&');
    const path = `/v1/data_sources/${this.cfg.dataSourceId}/query${qs ? `?${qs}` : ''}`;
    const out: NotionPage[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.request('POST', path, 'data source query', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      if (data?.request_status?.type === 'incomplete') throw new Error('Notion returned an incomplete result (query limit reached). Refusing to continue with partial data.');
      out.push(...(data.results as NotionPage[]));
      if (!data.has_more) return out;
      cursor = data.next_cursor;
    }
    throw new Error(`Notion query did not finish after ${MAX_PAGES} pages`);
  }
}

/** The properties a proposal needs. Everything else in the row (Features, Listing Agent, Deals, ...) is never requested. */
export const PROPOSAL_PROPERTIES = [
  NOTION.name, NOTION.address, NOTION.price, NOTION.yield, NOTION.designCategory, NOTION.buildType, NOTION.state, NOTION.listingEndDate,
  NOTION.webStatus, NOTION.webPublicAddress, NOTION.webDescription, NOTION.webPricingMode, NOTION.webDisplayPrice,
  NOTION.webApprovedBy, NOTION.webTitle, NOTION.webFeatured,
];

/** Fetches a public media manifest. The Notion token is never sent to this host. */
export const fetchManifest = async (url: string, fetchImpl: typeof fetch = fetch): Promise<MediaManifest> => {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Media manifest fetch failed with HTTP ${res.status}`);
  return (await res.json()) as MediaManifest;
};
