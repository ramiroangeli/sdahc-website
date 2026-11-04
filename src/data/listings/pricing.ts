import { PRICING_MODE_LABEL, type Pricing } from './schema';

/*
  Public pricing. The CRM "Price" field is never read here. A price reaches the site only as a
  human-written, human-approved display amount in AUD (Web Display Price), and only when the Pricing
  Mode is Asking Price or Price Guide.
*/

const MIN_AUD = 50_000;
const MAX_AUD = 100_000_000;

const amounts = (raw: string): number[] =>
  [...raw.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')));

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

/** Accepts "$695,000", "695000", "$650,000 - $700,000", "650000 to 700000". Returns the canonical form. */
export const normalisePriceDisplay = (raw: string): string => {
  const cleaned = raw.trim();
  if (!cleaned) throw new Error('Web Display Price is empty');
  if (/[a-z]/i.test(cleaned.replace(/\b(to|aud)\b/gi, ''))) throw new Error(`Web Display Price "${raw}" must contain amounts only`);
  const nums = amounts(cleaned);
  if (nums.length < 1 || nums.length > 2) throw new Error(`Web Display Price "${raw}" must be one amount or one range`);
  for (const n of nums) {
    if (n < MIN_AUD || n > MAX_AUD) throw new Error(`Web Display Price amount ${n} is outside the plausible range`);
  }
  if (nums.length === 2 && nums[0] >= nums[1]) throw new Error('Price range must run from lower to higher');
  return nums.map(fmt).join(' to ');
};

export interface PricingView {
  label: string;
  /** Present only when an approved amount exists. Always AUD. */
  value?: string;
  currency?: 'AUD';
}

export const formatPricing = (p: Pricing): PricingView =>
  p.display ? { label: PRICING_MODE_LABEL[p.mode], value: p.display, currency: 'AUD' } : { label: PRICING_MODE_LABEL[p.mode] };

/** One line for cards: "Asking Price $695,000 AUD", "Expressions of Interest", "Contact Agent". */
export const pricingLine = (p: Pricing): string => {
  const v = formatPricing(p);
  return v.value ? `${v.label} ${v.value} AUD` : v.label;
};

/** Numeric bounds for structured data. Only meaningful when an approved amount exists. */
export const pricingBounds = (p: Pricing): { min: number; max: number } | null => {
  if (!p.display) return null;
  const n = amounts(p.display);
  return { min: n[0], max: n[n.length - 1] };
};
