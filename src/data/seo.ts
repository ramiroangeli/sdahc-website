// Shared search and AI-visibility data: stable schema.org identifiers, the business facts every
// page's structured data repeats, and the "last updated" date of each page.
//
// Page dates live in page-dates.json (also read by the sitemap in astro.config.mjs). When you
// change a page's content, update its date there in the same commit, so the sitemap <lastmod>
// and the visible "Updated" line stay truthful. Do not bump dates for code-only changes.
import pageDates from './page-dates.json';

export const SITE = 'https://sdahomechoices.com.au';
export const ORG_ID = `${SITE}/#organization`;
export const WEBSITE_ID = `${SITE}/#website`;
export const STEVE_ID = `${SITE}/about/#steve-dawson`;

export const PHONE = '+61 408 550 441';
export const EMAIL = 'research@sdahomechoices.com.au';
export const LINKEDIN = 'https://www.linkedin.com/company/sda-home-choices/';

export const OFFICES = [
  { name: 'Queensland Office', street: '17 Sternlight Street', locality: 'Noosaville', region: 'QLD', postcode: '4566' },
  { name: 'Victoria Office', street: 'Suite 34, Level 5, 33-35 Stewart Street', locality: 'Richmond', region: 'VIC', postcode: '3121' },
] as const;

const dates = pageDates as Record<string, string>;

/** ISO date (YYYY-MM-DD) a page's content last changed, or undefined if it is not tracked. */
export function updatedFor(path: string): string | undefined {
  const key = path.endsWith('/') ? path : `${path}/`;
  return dates[key];
}

/** "26 September 2026" style date, Australian English. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function postalAddress(o: (typeof OFFICES)[number]) {
  return {
    '@type': 'PostalAddress',
    streetAddress: o.street,
    addressLocality: o.locality,
    addressRegion: o.region,
    postalCode: o.postcode,
    addressCountry: 'AU',
  };
}

/** The firm itself. Emitted once per page by BaseLayout; other nodes refer to it by @id. */
export const organization = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'SDA Home Choices',
  alternateName: 'SDAHC',
  legalName: 'SDA Home Choices Pty Ltd',
  url: `${SITE}/`,
  logo: { '@type': 'ImageObject', url: `${SITE}/favicon-512.png`, width: 512, height: 512 },
  image: `${SITE}/images/og-brand.jpg`,
  description: "Independent advisory and transactions firm working exclusively in Australia's Specialist Disability Accommodation (SDA) market: property and portfolio sales, vendor due diligence, strategic divestment advisory and SDA market research.",
  email: EMAIL,
  telephone: PHONE,
  address: postalAddress(OFFICES[0]),
  location: OFFICES.map((o) => ({ '@type': 'Place', name: `SDA Home Choices ${o.name}`, address: postalAddress(o) })),
  areaServed: { '@type': 'Country', name: 'Australia' },
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer service',
    telephone: PHONE,
    email: EMAIL,
    areaServed: 'AU',
    availableLanguage: 'English',
  },
  employee: { '@id': STEVE_ID },
  knowsAbout: [
    'Specialist Disability Accommodation',
    'SDA property sales',
    'SDA portfolio divestment',
    'Vendor due diligence',
    'SDA market research',
    'National Disability Insurance Scheme housing',
  ],
  sameAs: [LINKEDIN],
};

export const website = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: 'SDA Home Choices',
  url: `${SITE}/`,
  inLanguage: 'en-AU',
  publisher: { '@id': ORG_ID },
};

export interface Crumb { name: string; path: string }

export function breadcrumbList(crumbs: Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: new URL(c.path, SITE).href,
    })),
  };
}

/** A specialist service the firm provides, for the service pages. */
export function service(name: string, description: string, path: string) {
  return {
    '@type': 'Service',
    name,
    description,
    url: new URL(path, SITE).href,
    serviceType: name,
    provider: { '@id': ORG_ID },
    areaServed: { '@type': 'Country', name: 'Australia' },
    audience: { '@type': 'BusinessAudience', audienceType: 'SDA property owners, investors, providers, lenders and family offices' },
  };
}

/** FAQPage built from question/answer pairs that are ALSO shown on the page, word for word. */
export function faqPage(items: { q: string; a: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  };
}
