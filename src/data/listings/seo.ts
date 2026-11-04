import { isDemoPhoto, type PublicListing } from './schema';
import { pricingBounds } from './pricing';

/*
  Structured data and social metadata for a listing page. Built only from PublicListing, so it
  inherits the same guarantees: street name without a number, no coordinates, no internal data.
  There are deliberately no geo coordinates anywhere: a point on a map is a precise address.
*/

/** The first real photograph at the widest variant. Demo placeholders never become an OG image. */
export const listingOgImage = (l: PublicListing): string | undefined => {
  for (const p of l.photos) {
    if (isDemoPhoto(p)) continue;
    const best = [...p.variants].sort((a, b) => b.w - a.w)[0];
    if (best) return best.src;
  }
  return undefined;
};

export const listingJsonLd = (l: PublicListing, siteUrl: string) => {
  const url = new URL(`/opportunities/${l.slug}/`, siteUrl).href;
  const images = l.photos.flatMap((p) => (isDemoPhoto(p) ? [] : [[...p.variants].sort((a, b) => b.w - a.w)[0].src]));
  const bounds = pricingBounds(l.pricing);
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: l.title,
    description: l.summary,
    url,
    datePosted: l.publishedAt,
    dateModified: l.updatedAt,
    ...(images.length ? { image: images } : {}),
    about: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: l.address.street,
        addressLocality: l.address.suburb,
        addressRegion: l.address.state,
        postalCode: l.address.postcode,
        addressCountry: 'AU',
      },
    },
    ...(bounds
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: 'AUD',
            ...(bounds.min === bounds.max
              ? { price: bounds.min }
              : { priceSpecification: { '@type': 'PriceSpecification', priceCurrency: 'AUD', minPrice: bounds.min, maxPrice: bounds.max } }),
          },
        }
      : {}),
  };
};
