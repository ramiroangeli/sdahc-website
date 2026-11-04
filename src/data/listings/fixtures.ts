import { contentHash, nextSnapshot } from './versioning';
import type { Accent, ApprovedSnapshot, ListingRecord, Photo, PublicContent } from './schema';

/*
  TEST FIXTURES ONLY. They exercise the hero, catalogue, detail page, gallery, statuses, the
  "newer draft awaiting approval" case and the no-photo state. They are excluded from production
  builds and a production deployment refuses to build if they are enabled (see publish.ts).

  What is real: the three streets, suburbs and postcodes the project owner supplied as test
  properties. The full internal addresses below stand in for the CRM record; they are internal-only
  and are never serialised to any page, URL, file name or metadata.
  What is NOT real: the commercial statuses (varied so each badge renders), every description, and
  all imagery. There are no photographs: each image is a graphic labelled DEMO. No price, yield,
  bedroom count or SDA design category has been invented, so cards show none.
*/

const APPROVED_AT = '2026-01-01T00:00:00.000Z';
const demo = (id: string, accent: Accent, n: number, of: number): Photo => ({
  demo: true,
  id,
  accent,
  alt: `DEMO placeholder image ${n} of ${of}. Not a photograph of the property.`,
});

const content = (c: PublicContent): PublicContent => c;

const fx1 = content({
  slug: 'rutherford-grove-armstrong-creek-vic',
  type: 'property',
  title: 'SDA property, Armstrong Creek',
  description: [
    'Demo listing used to test the page layout. It contains no verified property facts.',
    'Once a listing is approved, a short public description written by SDA Home Choices appears here.',
  ],
  address: { street: 'Rutherford Grove', suburb: 'Armstrong Creek', state: 'VIC', postcode: '3217' },
  pricing: { mode: 'eoi' },
  sda: {},
  photos: [demo('demo-armstrong-one', 'teal', 1, 3), demo('demo-armstrong-two', 'blue', 2, 3), demo('demo-armstrong-three', 'amber', 3, 3)],
});

const fx2Approved = content({
  slug: 'gymea-street-mount-duneed-vic',
  type: 'property',
  title: 'SDA property, Mount Duneed',
  description: ['Demo listing used to test the page layout. It contains no verified property facts.'],
  address: { street: 'Gymea Street', suburb: 'Mount Duneed', state: 'VIC', postcode: '3217' },
  pricing: { mode: 'contact_agent' },
  sda: {},
  photos: [demo('demo-duneed-one', 'blue', 1, 2), demo('demo-duneed-two', 'slate', 2, 2)],
});
// A newer draft that has NOT been approved: the approved version above must stay live.
const fx2Draft = content({
  ...fx2Approved,
  description: ['Demo listing, edited after approval. This wording must never appear on the page until it is approved.'],
});

const fx3 = content({
  slug: 'sheppard-street-shepparton-vic',
  type: 'property',
  title: 'SDA property, Shepparton',
  description: ['Demo listing used to test the no-photography state. It contains no verified property facts.'],
  address: { street: 'Sheppard Street', suburb: 'Shepparton', state: 'VIC', postcode: '3630' },
  pricing: { mode: 'eoi' },
  sda: {},
  photos: [],
});

const record = (id: string, webStatus: ListingRecord['webStatus'], draft: PublicContent, internalAddress: string, featured = false): ListingRecord => ({
  id,
  webStatus,
  featured,
  draft,
  approval: { by: 'Fixture approver', at: APPROVED_AT },
  isFixture: true,
  internal: { address: internalAddress },
});

export const FIXTURE_RECORDS: ListingRecord[] = [
  record('fx_001', 'published', fx1, '1/10 Rutherford Grove, Armstrong Creek VIC 3217', true),
  record('fx_002', 'under_offer', fx2Draft, '2/20 Gymea Street, Mount Duneed VIC 3217', true),
  record('fx_003', 'published', fx3, '30B Sheppard Street, Shepparton VIC 3630'),
];

const approvedFrom = (r: ListingRecord, c: PublicContent): ApprovedSnapshot => nextSnapshot(r, c, undefined, new Date(APPROVED_AT))!;

export const FIXTURE_SNAPSHOTS: ApprovedSnapshot[] = [
  approvedFrom(FIXTURE_RECORDS[0], fx1),
  approvedFrom(FIXTURE_RECORDS[1], fx2Approved),
  approvedFrom(FIXTURE_RECORDS[2], fx3),
];

// sanity: the pending-draft fixture really does differ from what is approved
if (contentHash(fx2Draft) === contentHash(fx2Approved)) throw new Error('fixture 2 must carry an unapproved draft');
