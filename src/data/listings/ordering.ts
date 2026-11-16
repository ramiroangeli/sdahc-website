import { z } from 'zod';

/*
  The default order of the public catalogue. SDA Home Choices staff set it in the internal Listings Manager; it is committed as
  display-order.json through the same reviewed publication path as a listing, so the static site only ever reads a local file.

  One rule, used by every page that lists properties (catalogue, homepage cards, related properties):
    1. Featured listings first. Several may be featured (the flag is a checkbox per listing), so within the featured group the saved order applies.
    2. Within each group, listings that have no place in the saved order yet (a newly published listing) come first, newest first,
       which is exactly how the site behaved before an order existed. Staff can then place them.
    3. Then the listings the saved order names, in that order.
  Ids in the saved order that are not public any more (withdrawn, never published) are ignored, so a stale entry can never hide or reveal anything.
  The order file holds listing ids only. It cannot add a listing to the site and carries no listing content.
*/

export const LISTING_ID_RE = /^lst_[a-f0-9]{10}$/;

export const displayOrderSchema = z
  .object({ version: z.literal(1), order: z.array(z.string().regex(LISTING_ID_RE)).max(500) })
  .strict()
  .refine((d) => new Set(d.order).size === d.order.length, { message: 'a listing appears twice in the display order' });

export type DisplayOrder = z.infer<typeof displayOrderSchema>;

export const parseDisplayOrder = (raw: unknown): DisplayOrder => displayOrderSchema.parse(raw);

interface Orderable { id: string; featured: boolean; publishedAt: string; title: string }

export const orderListings = <T extends Orderable>(listings: readonly T[], order: readonly string[] = []): T[] => {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...listings].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== rb) {
      if (ra === undefined) return -1; // not placed yet: ahead of the placed ones, as before
      if (rb === undefined) return 1;
      return ra - rb;
    }
    return b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
};
