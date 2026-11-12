// Pure helpers for the publication job that the internal Listings Manager starts (scripts/listings-publish-job.mjs).
// No network and no file access here, so everything is covered by scripts/test-listings.mjs.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PUBLIC_ID_RE = /^lst_[a-f0-9]{10}$/;
export const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MODES = ['dry_run', 'publish', 'update', 'withdraw'];
export const REAL_MODES = ['publish', 'update', 'withdraw'];

/* ---- request signing (shared secret between this repository's Actions and the internal app) ---- */
export const sign = (secret, timestamp, body) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
export const signedHeaders = (secret, body, now = Date.now()) => ({ 'x-listings-timestamp': String(now), 'x-listings-signature': sign(secret, String(now), body) });
export const verifySignature = (secret, timestamp, body, signature, now = Date.now(), maxSkewMs = 5 * 60 * 1000) => {
  if (!secret || !/^\d{10,16}$/.test(String(timestamp)) || Math.abs(now - Number(timestamp)) > maxSkewMs) return false;
  const a = Buffer.from(sign(secret, String(timestamp), body)); const b = Buffer.from(String(signature ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

const PRICING_LABEL = { asking_price: 'Asking Price', price_guide: 'Price Guide', eoi: 'Expressions of Interest', contact_agent: 'Contact Agent' };
const text = (s) => ({ type: 'rich_text', rich_text: s ? [{ plain_text: s }] : [] });
// must stay identical to descriptionBlocks in src/data/listings/description.ts (a test compares them)
const normaliseBlock = (block) => block.split('\n').map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).filter(Boolean).join('\n');
export const paragraphs = (raw) => String(raw ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(normaliseBlock).filter(Boolean);

/**
 * The Notion row as it WOULD read after the approved fields are synchronised: the real row (internal fields intact, used by the
 * safety checks) with only the Web* properties replaced by the approved draft. Nothing is written to Notion.
 */
export const COMMERCIAL_STATUSES = ['available', 'under_offer', 'sold'];
const STATUS_NOTION = { available: 'Published', under_offer: 'Under Offer', sold: 'Sold' };

/**
 * The commercial status this job publishes: the one the Publisher requested in the signed payload, else the status the website already
 * shows (a content update never changes it), else Available for a first publication. Notion's own Web Listing Status is never consulted.
 */
export const effectiveStatus = (payload, previous) => {
  const asked = payload?.content?.commercialStatus;
  if (COMMERCIAL_STATUSES.includes(asked)) return asked;
  return COMMERCIAL_STATUSES.includes(previous?.commercialStatus) ? previous.commercialStatus : 'available';
};

/** Does the snapshot carry the commercial status the Publisher asked for? (Nothing asked means nothing to compare.) */
export const statusParity = (snapshot, payload) => {
  const asked = payload?.content?.commercialStatus;
  return asked === undefined || asked === null || snapshot?.commercialStatus === asked ? [] : ['commercial status'];
};

export function overlayPage(page, payload, approver, previous = null) {
  const c = payload.content;
  const props = { ...page.properties };
  // Notion is the CRM, not the authority for public marketing status or end dates: both come from the portal and the existing snapshot
  props['Web Listing Status'] = { type: 'select', select: { name: STATUS_NOTION[effectiveStatus(payload, previous)] } };
  props['Listing End Date'] = { type: 'date', date: previous?.listingEndDate ? { start: previous.listingEndDate } : null };
  props['Web Public Address'] = text(c.publicAddress);
  props['Web Description'] = text(c.description);
  props['Web Title'] = text(c.title);
  props['Web Pricing Mode'] = { type: 'select', select: { name: PRICING_LABEL[c.pricingMode] ?? '' } };
  props['Web Display Price'] = { type: 'number', number: c.displayPrice ?? null };
  props['Web Featured'] = { type: 'checkbox', checkbox: c.featured === true };
  props['Web Approved By'] = { type: 'people', people: approver?.notionUserId ? [{ id: approver.notionUserId, ...(approver.name ? { name: approver.name } : {}) }] : [] };
  return { ...page, properties: props };
}

const sortedKeys = (v) => (Array.isArray(v) ? v.map(sortedKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])])) : v);

/** Does the snapshot the engine produced say exactly what the Publisher approved? Returns problems (names only, no content). */
export function parity(snapshotContent, payload, expectedPhotos) {
  const problems = [];
  const c = payload.content;
  if (c.title && snapshotContent.title !== c.title) problems.push('title');
  const want = paragraphs(c.description);
  if (JSON.stringify(snapshotContent.description) !== JSON.stringify(want)) problems.push('description');
  if (`${snapshotContent.address.street}, ${snapshotContent.address.suburb} ${snapshotContent.address.state} ${snapshotContent.address.postcode}` !== c.publicAddress.replace(/\s+/g, ' ').trim()) problems.push('address');
  if (snapshotContent.pricing.mode !== c.pricingMode) problems.push('pricing mode');
  const wantPrice = c.displayPrice == null ? undefined : `$${Math.round(c.displayPrice).toLocaleString('en-AU')}`;
  if ((snapshotContent.pricing.display ?? undefined) !== wantPrice) problems.push('display price');
  // the optional public groups: the snapshot must carry exactly the groups the signed request carried, and no others
  const optional = c.optional ?? {};
  const got = { property: snapshotContent.property, investment: snapshotContent.investment, marketing: snapshotContent.marketing, descriptionApproval: snapshotContent.descriptionApproval };
  for (const g of ['property', 'investment', 'marketing', 'descriptionApproval']) if (JSON.stringify(sortedKeys(got[g] ?? null)) !== JSON.stringify(sortedKeys(optional[g] ?? null))) problems.push(`optional group ${g}`);
  for (const k of ['bedrooms', 'residentPlaces', 'ooa']) { const want = optional.sda?.[k]; if (want !== undefined && snapshotContent.sda?.[k] !== want) problems.push(`sda ${k}`); }
  const ids = (payload.manifest?.photos ?? []).map((p) => p.id);
  if (JSON.stringify(snapshotContent.photos.map((p) => p.id)) !== JSON.stringify(ids)) problems.push('photo order');
  // Version 2 freezes every public SDA fact and the complete generated image metadata reviewed by the Publisher.
  // Version 1 remains supported during the coordinated rollout.
  if (payload.version === 2) {
    if (!payload.reviewedSda || JSON.stringify(sortedKeys(snapshotContent.sda ?? null)) !== JSON.stringify(sortedKeys(payload.reviewedSda))) problems.push('reviewed SDA details');
    if (!expectedPhotos || JSON.stringify(sortedKeys(snapshotContent.photos)) !== JSON.stringify(sortedKeys(expectedPhotos))) problems.push('reviewed photographs');
  }
  return problems;
}

/** A manifest the engine can read without any network: only photographs a Publisher actually reviewed are accepted. */
export function checkManifest(manifest) {
  const problems = [];
  if (manifest?.version !== 1 || !Array.isArray(manifest.photos) || manifest.photos.length === 0) problems.push('manifest has no photographs');
  for (const p of manifest?.photos ?? []) {
    if (p.privacyReviewed !== true) problems.push('a photograph was not covered by the gallery review');
    if (!/^[a-f0-9]{12}$/.test(p.id ?? '')) problems.push('a photograph id is not a content hash');
  }
  return problems;
}

/**
 * Retries a flaky call (a connection closed while a long build ran, a 5xx, a rate limit) a few times with growing pauses.
 * Progress and the final result must not be lost to one dropped connection. The app treats repeated events as harmless.
 */
export async function withRetry(fn, { attempts = 5, baseMs = 400, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (e && e.retryable === false) throw e;
      if (i < attempts - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/**
 * Who approved, for a publication started from the internal Listings Manager. The Listings Manager is where staff approve: the payload is
 * authenticated by the signed request, and the person is a Publisher in the app's own staff list, so that approval is the authority and the
 * Notion approvers list does not apply to it. (The command line flow, listings-sync, still uses src/data/listings/approvers.json.)
 * The name ends up in the public snapshot, so it is a display name, never an email address.
 */
export function approverFor(payload, approvers = []) {
  const a = payload?.approver;
  if (payload?.authority === 'listings_manager' && a && /^[A-Za-z0-9:_-]{6,64}$/.test(a.id ?? '')) {
    const raw = String(a.name ?? '');
    const name = raw.includes('@') ? '' : raw.replace(/[^\p{L}\p{N} .,'&()-]/gu, '').trim().slice(0, 60);
    return { id: a.id, name: name || 'SDA Home Choices', via: 'listings_manager' };
  }
  const listed = approvers.find((x) => x.notionUserId === a?.notionUserId) ?? null;
  return listed ? { id: listed.notionUserId, name: listed.name, via: 'approvers_list' } : null;
}
