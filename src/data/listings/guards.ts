import type { ComplianceConfig, PublicContent } from './schema';
import { isDemoPhoto } from './schema';

/*
  Safety checks on the public content of a listing. These are a SECOND line of defence: the model
  already has no field for a house number, an internal price or a document link. The guards exist to
  catch the case where someone types one into free text (a title, a description, an alt text).

  Every check runs on the whole serialised content, so it also covers the slug, the alt text, the
  photo file names and anything later added to the model. Pricing is the one place a dollar amount
  is allowed, and only the approved display value.
*/

export interface SafetyContext {
  /** Full CRM address, when known (promotion time). Used to detect that exact address leaking. */
  internalAddress?: string;
  internalPriceAud?: number;
  internalYieldPct?: number;
  /** Public origin photos may be served from, e.g. a Vercel Blob public store. */
  mediaBaseUrl?: string;
  /** Notion user ids allowed to approve a listing for publication. Empty means nobody: default deny. */
  authorisedApproverIds?: string[];
  /** Compliance clearances. Absent means nothing is cleared (default deny). */
  compliance?: ComplianceConfig;
  /** Demo placeholders are only acceptable in fixtures and development. */
  allowDemo: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const LINKS = /sharepoint|onedrive|notion\.(so|site)|\bnotion[_ -]?page|docs\.google|dropbox|\.pdf\b/i;
const MONEY = /\$\s?\d|\b\d[\d,]*\s?(?:aud|dollars)\b|\b(?:yield|cap rate|rental income|net rent|gross rent|noi|roi|return on investment)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?61|\b0)[\s-]?[2-478](?:[\s-]?\d){8}\b/;
const PHOTO_FILE = /\/[a-f0-9]{10,}-\d{3,4}\.(?:webp|jpg|avif)$/;

/** Splits "1/10 Rutherford Grove, ..." into unit, number and street name. */
const parseInternal = (addr: string) => {
  const m = /^\s*(?:(?:unit|apt|apartment)\s*)?(?:(\d+[a-z]?)\s*\/\s*)?(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\s+([^,]+?)\s*(?:,|$)/i.exec(addr);
  return m ? { unit: m[1], number: m[2], street: m[3] } : null;
};

/** Returns a list of problems. Empty means the content is safe to publish. */
export const checkPublicSafety = (c: PublicContent, ctx: SafetyContext): string[] => {
  const issues: string[] = [];
  const full = norm(JSON.stringify(c));
  const { pricing, ...rest } = c;
  // dollar amounts are checked everywhere except the approved display value
  const withoutPrice = norm(JSON.stringify({ ...rest, pricing: { mode: pricing.mode } }));

  // 1. house or unit number next to the street name, anywhere in the serialised content
  const street = esc(norm(c.address.street));
  if (new RegExp(`\\b\\d+[a-z]?(?:\\s*[-/]\\s*\\d+[a-z]?)?\\s+${street}`, 'i').test(full) || new RegExp(`${street}\\s+\\d{1,3}[a-z]?\\b`, 'i').test(full)) {
    issues.push('a house or unit number appears next to the street name');
  }
  if (ctx.internalAddress) {
    const parsed = parseInternal(ctx.internalAddress);
    if (parsed) {
      const internalStreet = esc(norm(parsed.street));
      if (new RegExp(`\\b\\d+[a-z]?(?:\\s*[-/]\\s*\\d+[a-z]?)?\\s+${internalStreet}`, 'i').test(full)) {
        issues.push('the internal street number appears in public content');
      }
      if (parsed.unit && full.includes(`${parsed.unit.toLowerCase()}/${parsed.number.toLowerCase().replace(/\s+/g, '')}`)) {
        issues.push('the internal unit/number combination appears in public content');
      }
    }
    if (full.includes(norm(ctx.internalAddress))) issues.push('the full internal address appears in public content');
  }

  // 2. links to private systems
  if (LINKS.test(full)) issues.push('a link or reference to a private document system appears in public content');

  // 3. internal financial data
  if (MONEY.test(withoutPrice)) issues.push('a dollar amount or financial term appears outside the approved price');
  if (ctx.internalPriceAud) {
    const n = ctx.internalPriceAud;
    const forms = [String(n), n.toLocaleString('en-AU'), n.toLocaleString('en-US')];
    if (forms.some((f) => withoutPrice.includes(f))) issues.push('the internal CRM price appears in public content');
  }
  if (ctx.internalYieldPct != null && new RegExp(`\\b${esc(String(ctx.internalYieldPct))}\\s?%`).test(withoutPrice)) {
    issues.push('the internal yield appears in public content');
  }

  // 4. personal data (participants, staff, owners)
  const prose = norm(JSON.stringify({ t: c.title, d: c.description, p: c.photos.map((p) => p.alt) }));
  if (EMAIL.test(prose)) issues.push('an email address appears in public text');
  if (PHONE.test(prose)) issues.push('a phone number appears in public text');

  // 4b. Basic is existing (legacy) SDA stock. It must never be described as a new build or a certified new dwelling.
  if (c.sda.designCategories?.includes('Basic')) {
    const text = norm(JSON.stringify({ t: c.title, d: c.description, b: c.sda.buildingType }));
    if (/\b(new[- ]?build|newly[- ]built|brand[- ]new|purpose[- ]built|newly constructed|new dwelling)\b/.test(text)) {
      issues.push('a Basic design category listing is described as a new build; the Basic classification must not be presented as new-build SDA');
    }
  }

  // 5. photographs
  for (const p of c.photos) {
    if (isDemoPhoto(p)) {
      if (!ctx.allowDemo) issues.push('a demo placeholder photo is present outside fixtures');
      continue;
    }
    for (const v of p.variants) {
      const okOrigin = ctx.mediaBaseUrl ? v.src.startsWith(`${ctx.mediaBaseUrl.replace(/\/$/, '')}/`) : v.src.startsWith('/images/listings/');
      if (!okOrigin) issues.push(`photo ${p.id} is not served from the approved public media origin`);
      if (!PHOTO_FILE.test(v.src)) issues.push(`photo ${p.id} file name is not a content hash (names must never carry an address)`);
      if (/[?#]/.test(v.src)) issues.push(`photo ${p.id} URL carries a query string`);
    }
  }
  return issues;
};

export class PublicSafetyError extends Error {
  constructor(public issues: string[]) {
    super(`Unsafe public content: ${issues.join('; ')}`);
  }
}

export const assertPublicSafe = (c: PublicContent, ctx: SafetyContext): void => {
  const issues = checkPublicSafety(c, ctx);
  if (issues.length) throw new PublicSafetyError(issues);
};
