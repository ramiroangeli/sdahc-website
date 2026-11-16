# Default order of the public catalogue

## The rule

One rule, applied in `src/data/listings/ordering.ts` and used by every page that lists properties (catalogue, homepage cards, related properties):

1. Featured listings first. The flag is a checkbox per listing, so several can be featured.
2. Inside each group, the listings the saved order names come first, in that order.
3. Then listings with no place in the saved order (for example a newly published one), newest first.

With no saved order: featured first, then newest first.

Ids in the saved order that are not public any more (withdrawn) are ignored. Sold and Withdrawn visibility is decided before ordering, so ordering can never reveal or hide a listing. Off-market opportunities are not part of this feature.

## Why Featured did not put Armstrong Creek first (fixed here)

The Featured flag was saved, approved and published correctly (`"featured": true` in the approved snapshot), but the catalogue never read it. The public list was sorted by first publication date, newest first, and only the homepage card fan looked at `featured`. Sheppard Street (published 9 November) therefore stayed ahead of Rutherford Grove (published 5 November). "Showing 2 of 2 properties" is the count of matching properties, not a carousel position.

## Where the saved order lives

`src/data/listings/display-order.json`: `{ "version": 1, "order": ["lst_...", ...] }`. Listing ids only, no content. It is validated with a strict schema at build time, so a malformed file fails the build.

Staff set it in the internal Listings Manager ("Website display order"). That starts the publication workflow in mode `reorder`, which opens a one-file pull request that changes only this file, waits for the required check, merges, waits for the Vercel deployment and checks that the live catalogue lists the properties in the new order. The site is static, so the new order is live after that deployment (a few minutes), not instantly.

The same file can be edited by hand in a normal pull request. `npm run check:order` (run in CI after the build) fails if the built catalogue is not in the order the rule produces.

## Visitors

The default "Sort by" option is "Recommended" (the order above). "Newest first", "Suburb A to Z" and "Availability" keep working, and filters narrow the list without changing the order. Reloading the page or pressing Clear returns to Recommended.
