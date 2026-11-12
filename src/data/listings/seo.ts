import { DESIGN_LABEL, isDemoPhoto, type Photo, type PublicListing } from './schema';
import { pricingBounds } from './pricing';
import { coverPhoto } from './card';
import { ORG_ID, SITE, WEBSITE_ID } from '../seo';

/*
  Search and social metadata for a listing page. Built only from PublicListing, so it inherits the same guarantees: street name without a number,
  no coordinates, no internal data. Everything here comes from approved, structured public values. Nothing is taken from the free-text description
  (it may contain marketing claims), nothing is parsed or calculated, and no income, yield, tenancy, occupancy or provider information is ever used:
  those are shown in the visible page only, and only where approved.
  There are deliberately no geo coordinates anywhere: a point on a map is a precise address.
*/

const designWords = (l: PublicListing): string => {
  const d = l.sda.designCategories ?? [];
  return d.length ? d.map((x) => DESIGN_LABEL[x]).join(', ') : '';
};
const noun = (l: PublicListing): string => (l.type === 'portfolio' ? 'SDA portfolio' : 'SDA property');
const place = (l: PublicListing): string => `${l.address.suburb}, ${l.address.state}`;
export const listingPath = (l: PublicListing): string => `/opportunities/${l.slug}/`;

/**
 * The page title. Category, place and status decide it, so it reads naturally and never calls a Sold or Under offer property available.
 *   Available:   "Improved Liveability SDA property for sale in Armstrong Creek, VIC | SDA Home Choices"
 *   Under offer: "... SDA property under offer in ..."      Sold: "Sold ... SDA property in ..."
 */
export const listingSeoTitle = (l: PublicListing): string => {
  const cat = designWords(l);
  const what = `${cat ? `${cat} ` : ''}${noun(l)}`;
  const head = l.commercialStatus === 'sold' ? `Sold ${what} in ${place(l)}` : l.commercialStatus === 'under_offer' ? `${what} under offer in ${place(l)}` : `${what} for sale in ${place(l)}`;
  return `${head} | SDA Home Choices`;
};

/** Titles must be unique across the site: where two listings would read the same, the public street name tells them apart. */
export const uniqueSeoTitles = (all: PublicListing[]): Map<string, string> => {
  const base = new Map(all.map((l) => [l.id, listingSeoTitle(l)] as const));
  const counts = new Map<string, number>();
  for (const t of base.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
  return new Map(all.map((l) => {
    const t = base.get(l.id)!;
    return [l.id, (counts.get(t) ?? 0) > 1 ? t.replace(` in ${place(l)} |`, ` in ${place(l)} (${l.address.street}) |`) : t] as const;
  }));
};

const clip = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

/**
 * The meta description: a plain factual sentence from approved structured fields, then the next step. No price, income, yield, tenancy or provider
 * wording. Sold and Under offer say so.
 */
export const listingSeoDescription = (l: PublicListing): string => {
  const cat = designWords(l);
  const what = `${cat ? `${cat} ` : ''}${noun(l)}`;
  const bits = [l.sda.buildingType, l.sda.bedrooms ? `${l.sda.bedrooms} bedrooms` : undefined, l.property?.bathrooms ? `${l.property.bathrooms} bathrooms` : undefined].filter(Boolean);
  const facts = bits.length ? ` (${bits.join(', ')})` : '';
  const MAX = 160;
  // the facts are the first thing to drop when the sentence is too long, so the call to action is never cut off mid-word
  const fit = (build: (f: string) => string) => { const full = build(facts); return clip(full.length <= MAX ? full : build(''), MAX); };
  if (l.commercialStatus === 'sold') return fit(() => `Sold: ${what} in ${place(l)}. Tell SDA Home Choices what you are looking for and we will contact you when a similar SDA property becomes available.`);
  if (l.commercialStatus === 'under_offer') return fit((f) => `Under offer: ${what} in ${place(l)}${f}. Register your interest in similar SDA properties.`);
  return fit((f) => `${what} for sale in ${place(l)}${f}. Register your interest with SDA Home Choices.`);
};

export interface OgImage { url: string; width: number; height: number; alt: string }

/**
 * The social-sharing image: the first photograph that is not a floorplan (a floorplan only when it is the only image), at its widest prepared size,
 * with its real dimensions and its approved description as the alt text. Demo placeholders never become an OG image. Undefined means: use the brand card.
 */
export const listingOgImageInfo = (l: PublicListing): OgImage | undefined => {
  const p = coverPhoto(l.photos) ?? l.photos[0];
  if (!p || isDemoPhoto(p)) return undefined;
  const best = [...p.variants].sort((a, b) => b.w - a.w)[0];
  if (!best) return undefined;
  return { url: best.src, width: best.w, height: Math.round((best.w * p.height) / p.width), alt: p.alt };
};
/** Kept for callers that only need the address of the image. */
export const listingOgImage = (l: PublicListing): string | undefined => listingOgImageInfo(l)?.url;

const imageObject = (p: Photo): Record<string, unknown> | null => {
  if (isDemoPhoto(p)) return null;
  const best = [...p.variants].sort((a, b) => b.w - a.w)[0];
  if (!best) return null;
  return { '@type': 'ImageObject', url: best.src, width: best.w, height: Math.round((best.w * p.height) / p.width), caption: p.alt, ...(p.kind === 'floorplan' ? { name: 'Floorplan' } : {}) };
};

/**
 * The schema.org node for the listing, for the page's linked graph (the firm, the website and the breadcrumb trail come from the layout).
 *  - An offer only for an Available property with an approved public price. Under offer and Sold carry none, so structured data never implies a
 *    property can be bought unconditionally.
 *  - Optional physical facts appear only when approved (bedrooms, bathrooms, floor area). Nothing financial or tenancy-related is ever included.
 */
export const listingNode = (l: PublicListing, siteUrl: string = SITE) => {
  const url = new URL(listingPath(l), siteUrl).href;
  const images = l.photos.map(imageObject).filter((x): x is Record<string, unknown> => !!x).slice(0, 10);
  const bounds = pricingBounds(l.pricing);
  const bedrooms = l.sda.bedrooms;
  const bathrooms = l.property?.bathrooms;
  const floor = l.property?.floorAreaM2;
  return {
    '@type': 'RealEstateListing',
    '@id': `${url}#listing`,
    name: l.title,
    description: listingSeoDescription(l),
    url,
    inLanguage: 'en-AU',
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORG_ID },
    datePosted: l.publishedAt,
    dateModified: l.updatedAt,
    ...(images.length ? { image: images, primaryImageOfPage: images[0] } : {}),
    about: {
      '@type': 'Accommodation',
      address: {
        '@type': 'PostalAddress',
        streetAddress: l.address.street,
        addressLocality: l.address.suburb,
        addressRegion: l.address.state,
        postalCode: l.address.postcode,
        addressCountry: 'AU',
      },
      ...(bedrooms ? { numberOfBedrooms: bedrooms } : {}),
      ...(bathrooms ? { numberOfBathroomsTotal: bathrooms } : {}),
      ...(floor ? { floorSize: { '@type': 'QuantitativeValue', value: floor, unitCode: 'MTK' } } : {}),
    },
    ...(bounds && l.commercialStatus === 'available'
      ? {
          offers: {
            '@type': 'Offer',
            url,
            priceCurrency: 'AUD',
            availability: 'https://schema.org/InStock',
            seller: { '@id': ORG_ID },
            ...(bounds.min === bounds.max
              ? { price: bounds.min }
              : { priceSpecification: { '@type': 'PriceSpecification', priceCurrency: 'AUD', minPrice: bounds.min, maxPrice: bounds.max } }),
          },
        }
      : {}),
  };
};

/** Standalone form with its own @context, kept for tools and tests that expect a complete document. */
export const listingJsonLd = (l: PublicListing, siteUrl: string) => ({ '@context': 'https://schema.org', ...listingNode(l, siteUrl) });
