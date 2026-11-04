import { createHash } from 'node:crypto';
import type { PublicListing } from '../data/listings/schema';
import { escapeHtml } from './enquiry-http';

/*
  Listing enquiries: validation, abuse controls, delivery sinks and the CRM link step.

  Flow:  website form -> /api/listing-enquiry/ -> EnquiryRecord -> sink(s) -> CRM (find or link Contact).

  What is implemented and tested: validation, anti-spam, rate limiting, the email sink, a dry-run
  sink, and the CRM matching logic against an injectable CrmClient. What is NOT implemented: a real
  Notion CrmClient and an Enquiries store. They need the Contacts schema confirmed and an approved
  Enquiries destination, so nothing here ever reports a CRM write that did not happen.

  The CrmClient interface has no method that creates a Deal. A Deal cannot be created from an
  enquiry by this code, by design; converting an enquiry into a Deal is a human action in the CRM.
*/

export interface EnquiryInput {
  listingId: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  consent: boolean;
  source: 'listing_page';
}
export interface EnquiryRecord extends EnquiryInput {
  id: string;
  receivedAt: string;
  status: 'received';
}

export type ParseResult = { ok: true; value: EnquiryInput; submittedAfterMs: number } | { ok: false; error: string; status: number };

const MIN_FILL_MS = 2500;
const MAX_FILL_MS = 24 * 60 * 60 * 1000;

export const parseEnquiry = (data: FormData, nowMs: number): ParseResult => {
  const f = (k: string) => ((data.get(k) as string) || '').trim();
  // honeypot: a real visitor never fills the hidden field. Treated as success so bots learn nothing.
  if (f('company')) return { ok: false, error: '', status: 204 };
  const started = Number(f('ts'));
  const took = nowMs - started;
  if (!Number.isFinite(started) || took < MIN_FILL_MS || took > MAX_FILL_MS) {
    return { ok: false, error: 'Please take a moment to complete the form and try again.', status: 400 };
  }
  const name = f('name');
  const email = f('email').toLowerCase();
  const phone = f('phone');
  const message = f('message');
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Please complete your name, a valid email and your enquiry.', status: 400 };
  }
  if (phone && !/^[\d\s+()-]{6,25}$/.test(phone)) return { ok: false, error: 'Please enter a valid phone number or leave it blank.', status: 400 };
  if (f('consent') !== 'yes') return { ok: false, error: 'Please confirm you have read the privacy policy.', status: 400 };
  if (name.length > 100 || email.length > 200 || message.length > 2000) return { ok: false, error: 'One or more fields is too long.', status: 400 };
  // a message that is mostly links is almost always spam
  if ((message.match(/https?:\/\//g) ?? []).length > 2) return { ok: false, error: 'Please remove links from your message.', status: 400 };
  return {
    ok: true,
    submittedAfterMs: took,
    value: { listingId: f('listing_id'), name, email, ...(phone ? { phone } : {}), message, consent: true, source: 'listing_page' },
  };
};

export const toRecord = (i: EnquiryInput, now: Date): EnquiryRecord => ({
  ...i,
  id: createHash('sha256').update(`${i.email}|${i.listingId}|${now.toISOString().slice(0, 10)}`).digest('hex').slice(0, 16),
  receivedAt: now.toISOString(),
  status: 'received',
});

/**
 * Fixed-window limiter, kept in memory. On serverless each instance counts separately, so this is a
 * brake and not a guarantee: the real control is a Vercel Firewall rate-limit rule on this path.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}
export const hashKey = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24);

/* ---------- sinks ---------- */

export interface EnquirySink { name: 'dry-run' | 'email'; deliver(r: EnquiryRecord, l: PublicListing): Promise<{ ok: boolean }> }

export const dryRunSink: EnquirySink = { name: 'dry-run', deliver: async () => ({ ok: true }) };

export const createEmailSink = (send: (m: { to: string; replyTo: string; subject: string; html: string }) => Promise<{ error?: unknown }>, to: string): EnquirySink => ({
  name: 'email',
  async deliver(r, l) {
    const rows = [['listing', `${l.title} (${l.id})`], ['name', r.name], ['email', r.email], ['phone', r.phone ?? 'not provided'], ['message', r.message], ['source', r.source], ['received', r.receivedAt], ['reference', r.id]]
      .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`).join('');
    const { error } = await send({ to, replyTo: r.email, subject: `New listing enquiry: ${l.title}`, html: `<h2>New listing enquiry</h2>${rows}` });
    return { ok: !error };
  },
});

/* ---------- CRM link step (logic only; no real client yet) ---------- */

export interface CrmClient {
  findContactByEmail(email: string): Promise<{ id: string } | null>;
  createContact(c: { name: string; email: string; phone?: string; source: string }): Promise<{ id: string }>;
  createEnquiry(e: { record: EnquiryRecord; contactId: string }): Promise<{ id: string }>;
}

export interface CrmLinkResult { contactId: string; contactCreated: boolean; enquiryId: string; dealCreated: false }

/** Reuse a Contact matched by lower-cased email; create one only when there is none. Never creates a Deal. */
export const linkToCrm = async (crm: CrmClient, r: EnquiryRecord): Promise<CrmLinkResult> => {
  const existing = await crm.findContactByEmail(r.email.toLowerCase());
  const contact = existing ?? (await crm.createContact({ name: r.name, email: r.email.toLowerCase(), phone: r.phone, source: 'Website: Opportunities' }));
  const enquiry = await crm.createEnquiry({ record: r, contactId: contact.id });
  return { contactId: contact.id, contactCreated: !existing, enquiryId: enquiry.id, dealCreated: false };
};
