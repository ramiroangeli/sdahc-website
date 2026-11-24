import { createHash } from 'node:crypto';
import { publicAddressSchema, publicLocationSchema, STATES, type PublicAddress, type PublicLocation, type State } from './schema';

/*
  Public address handling. The CRM keeps the full address; the website only ever receives the value
  of the explicit "Web Public Address" field, written as "Street Name, Suburb STATE 1234".
  Parsing is strict on purpose: anything that carries a digit in the street or suburb is rejected
  rather than cleaned, so a house number can never be "stripped" imperfectly.
*/

const FORMAT = /^([^,\d]{3,60}),\s*([^,\d]{2,60}?)\s+([A-Za-z]{2,3})\s+(\d{4})$/;

export class AddressError extends Error {}

export const parsePublicAddress = (raw: string): PublicAddress => {
  const m = FORMAT.exec(raw.trim().replace(/\s+/g, ' '));
  if (!m) throw new AddressError('Web Public Address must read "Street Name, Suburb STATE 1234" with no house or unit number');
  const state = m[3].toUpperCase();
  if (!(STATES as readonly string[]).includes(state)) throw new AddressError(`Unknown state "${m[3]}"`);
  const parsed = publicAddressSchema.safeParse({ street: m[1].trim(), suburb: m[2].trim(), state: state as State, postcode: m[4] });
  if (!parsed.success) throw new AddressError(parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
};

export class LocationError extends Error {}
const POSTCODE_TAIL = /\s*\b\d{4}$/;
const NUMBER_WORDS = /\b(unit|lot|apt|apartment|flat|suite|level|shop)\b/i;
/**
 * What the team typed as the public location. Two accepted forms, never a third:
 *   - the street form published so far ("Street Name, Suburb STATE 1234"): kept exactly as before, so existing listings and their hashes do not change;
 *   - a public location: a region, commercial area or suburb ("Greater Darwin", "Berrimah NT"). No digits except a postcode at the very end (which is dropped), no unit or lot words,
 *     no links, emails or contact details. The state is NOT read from the text: it comes from the CRM. If the text names a different state the two contradict and it is refused;
 *     a broad region that does not literally match the suburb is fine. Nothing is inferred about official statistical areas and nothing here says the label was verified.
 * Anything else (a house or unit number, for example "21 Whipray Circuit, Berrimah") is refused, never cleaned.
 */
export const resolvePublicLocation = (raw: string, crmState?: string | null): { address: PublicAddress; location?: undefined } | { location: PublicLocation; address?: undefined } => {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new LocationError('Add a public location, such as "Greater Darwin" or "Berrimah NT". The full CRM address stays private.');
  try { return { address: parsePublicAddress(text) }; } catch { /* not the street form: a location */ }
  const withoutPostcode = text.replace(POSTCODE_TAIL, '');
  if (/\d/.test(withoutPostcode)) throw new LocationError('A public location cannot contain a house or unit number (or a lot number). Leave numbers out: a postcode at the end is allowed.');
  if (/[<>@\/\\]|https?:|www\./i.test(text)) throw new LocationError('A public location cannot contain a link, an email address or a slash.');
  if (NUMBER_WORDS.test(withoutPostcode)) throw new LocationError('A public location cannot name a unit, lot or level. Use the region or suburb.');
  const label = withoutPostcode.trim();
  if (label.length < 2 || label.length > 80) throw new LocationError('A public location is 2 to 80 characters.');
  const named = /\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s*$/i.exec(label)?.[1]?.toUpperCase();
  if (named && crmState && named !== crmState) throw new LocationError(`The location says ${named} but the CRM state for this property is ${crmState}. Check which is right.`);
  const state = (crmState ?? named) as State | undefined;
  if (!state || !(STATES as readonly string[]).includes(state)) throw new LocationError('The CRM has no State for this property, so the location cannot be published yet. Add the State in the CRM.');
  const parsed = publicLocationSchema.safeParse({ label, state });
  if (!parsed.success) throw new LocationError(parsed.error.issues.map((i) => i.message).join('; '));
  return { location: parsed.data };
};

export const streetLine = (a: PublicAddress) => a.street;
export const localityLine = (a: PublicAddress) => `${a.suburb} ${a.state} ${a.postcode}`;
export const formatPublicAddress = (a: PublicAddress) => `${a.street}, ${localityLine(a)}`;

const slugWords = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');

/** Letters-only suffix derived from a stable seed, so a suffix can never read as a house number. */
const letterSuffix = (seed: string, extra = 0) => {
  const h = createHash('sha256').update(`${seed}:${extra}`).digest();
  return Array.from(h.subarray(0, 4), (b) => String.fromCharCode(97 + (b % 26))).join('');
};

/** Slug from a public location: letters and hyphens only, with the same stable letter suffix when two listings would share it. */
export const makeLocationSlug = (l: PublicLocation, taken: ReadonlySet<string>, seed: string): string => {
  // the state is added once: a label that already ends with it ("Greater Darwin NT") must not read "...-nt-nt"
  const named = new RegExp(`\\b${l.state}$`, 'i').test(l.label.trim());
  const base = slugWords(named ? l.label : `${l.label} ${l.state}`).replace(/^-+/, '') || 'sda-property';
  const root = base.length >= 3 ? base : `sda-property-${base}`;
  if (!taken.has(root)) return root;
  for (let i = 0; i < 50; i += 1) { const candidate = `${root}-${letterSuffix(seed, i)}`; if (!taken.has(candidate)) return candidate; }
  throw new Error(`Could not derive a unique slug for ${root}`);
};

/**
 * Slug from the public address. Contains letters and hyphens only: no house number, no unit, not even
 * the postcode. If several properties share a street, later ones get a short stable letter suffix.
 * The first property to claim a slug keeps it; a published slug is stored in Notion and never changes.
 */
export const makeSlug = (a: PublicAddress, taken: ReadonlySet<string>, seed: string): string => {
  const base = slugWords(`${a.street} ${a.suburb} ${a.state}`);
  if (!taken.has(base)) return base;
  for (let i = 0; i < 50; i += 1) {
    const candidate = `${base}-${letterSuffix(seed, i)}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not derive a unique slug for ${base}`);
};
