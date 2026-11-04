import { createHash } from 'node:crypto';
import { publicAddressSchema, STATES, type PublicAddress, type State } from './schema';

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
