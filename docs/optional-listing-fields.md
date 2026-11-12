# Optional listing fields (data contract)

Backwards compatible and private by default. Every group below is optional. An absent group is never written, so the content hash of an existing listing does not change and existing approved files stay valid with no migration.

## Groups

| Group | Fields |
|---|---|
| `property` | `bathrooms`, `carSpaces`, `floorAreaM2`, `landAreaM2`, `parking`, `municipality` (bedrooms stay in `sda.bedrooms`) |
| `sda` (extended) | existing fields plus `ooa` (approved public wording) |
| `investment` | `leaseStatus` (fully_leased, partially_leased, unleased), `occupancyStatus` (fully_occupied, partially_occupied, vacant), `tenure`, `annualIncomeAud` + `incomeType` (gross, net), `yieldPct` + `yieldType`, `basis` (actual, projected), `providerArrangement`, `approval` |
| `marketing` | `agency`, a key in `agencies.json`; absent means SDA Home Choices |

Lease status and occupancy status are different facts and are never inferred from each other, or from a provider agreement or headlease. Either is shown only if it was approved. A figure never appears without its type (gross or net) and basis (actual or projected). Yield is never calculated or parsed from text.

## Approval (private by default)

- The `investment` block exists only when a Publisher approved those exact values for public advertising. No block means nothing is published.
- `approval.valuesHash` is the SHA-256 of every other value in the block (sorted keys). Changing any value without a fresh approval no longer matches: the safety check fails, the build refuses it, and the page helper (`publicInvestment`) returns nothing.
- `approval.provider: true` is a separate authorisation. Provider arrangement wording is invalid without it.
- The approver's identity and time are NOT in public content. They belong to the Listings Manager's private audit history.
- What this website code can and cannot prove: it proves the values were not altered after approval. It cannot authenticate a person. Authenticity is the Listings Manager's job (a Publisher-only, server-generated record that a browser request cannot supply) plus the existing signed payload and the protected pull request. That part ships in the Listings Manager PR.

## Victorian restriction

A Publisher may explicitly record a business authorisation for the exact Victorian income and yield values, with a private source, before they can be included. The Victorian flag is bound into the investment approval hash. A separate acknowledgement is required for a commercial description. This business authorisation is not a legal determination and does not resolve advertising obligations or override price compliance. See `docs/victorian-pricing-compliance.md`.

## Sold, Under offer, withdrawn

Under offer still shows approved facts. Sold shows no commercial figures. A withdrawn listing is not built, so nothing can surface.

## Marketing agency

`src/data/listings/agencies.json` is the whole registry: key, name and two brand files already in `src/assets` (`logo-navy.png` for light backgrounds, `logo-white.png` for dark). Adding an agency is a reviewed code-owner pull request. There is no agent database, profile page or destination link yet.

## Existing public content flagged for separate review (not changed)

- Sheppard Street (VIC): the description refers to an "existing SDA provider management arrangement" and to "current occupancy and investment details". Provider and occupancy wording on a Victorian listing should be reviewed under the same conservative approach.
- Whipray Circuit (NT): "high-yielding returns", "Tenanted Investment" and "established provider" were already flagged in the listing review pack.
