# Notion schema manifest: Web properties

Generated from the adapter by `node scripts/print-schema-manifest.mjs --write`. **Do not edit by hand**; a test fails if this file differs from the code.

Add these 9 properties to the existing **Properties** database (data source `2e2909c1-bb60-8177-bf4f-000b40ef0d48`). Nothing existing is renamed, removed or edited, and no record is changed. API version `2026-03-11`.

| # | Property | Notion type | Select options | Required | Default publication behaviour | Mapping into the public snapshot |
|---|---|---|---|---|---|---|
| 1 | Web Listing Status | Select | Not Published, Draft, In Review, Approved, Published, Under Offer, Sold, Withdrawn | always | Not Published. Blank or unrecognised also means Not Published, so nothing can go live. | Not stored. It is the visibility gate: Published, Under Offer and Sold set snapshot.commercialStatus (Available, Under offer, Sold); Draft, In Review and Approved are checked but never proposed; Withdrawn and Not Published are never proposed. |
| 2 | Web Public Address | Text (rich_text) |  | always | Blank blocks publication. | content.address { street, suburb, state, postcode }. Also the source of the slug. There is no field for a house or unit number. |
| 3 | Web Description | Text (rich_text) |  | always | Blank blocks publication. The CRM Description is never used. | content.description[] (one entry per paragraph). The first paragraph becomes the summary shown on cards. |
| 4 | Web Pricing Mode | Select | Asking Price, Price Guide, Expressions of Interest, Contact Agent | always | Blank blocks publication. | content.pricing.mode (asking_price, price_guide, eoi, contact_agent). |
| 5 | Web Approved By | Person (people) |  | always | Blank blocks publication. The person must also be on approvers.json (by Notion user id). | snapshot.approvedBy and snapshot.approvedById. Not shown on any page. |
| 6 | Web Display Price | Number |  | conditional | Blank is correct for EOI and Contact Agent. Required for Asking Price and Price Guide; filling it for the other two modes is reported and ignored. | content.pricing.display, formatted as "$695,000 AUD". Never copied from the CRM Price. |
| 7 | Web Title | Text (rich_text) |  | optional | Blank derives "SDA property, <suburb>". | content.title. |
| 8 | Web Featured | Checkbox |  | optional | Unchecked: not featured. | snapshot.featured (orders the hero cards). |
| 9 | Web Photo Folder | URL |  | optional | Blank is fine. | Not stored and never read by the website. A human pointer to the SharePoint "Approved for Website" folder. |

## Derived, so not created in Notion

- **slug**, from Web Public Address: letters and hyphens only; a letter suffix if another property shares the street; frozen once published
- **approval time**, from the proposal step: the moment the snapshot is proposed; git history is the record
- **photo manifest location**, from public listing id: <LISTINGS_MEDIA_BASE_URL>/<public id>/manifest.json
- **public listing id**, from Notion page id: lst_ + first 10 hex characters of the SHA-256 of the page id

## How these nine differ from the earlier twelve-field proposal

| Earlier proposal | Now | Why |
|---|---|---|
| Web Slug | Derived | The slug is generated from the public address and frozen at first publication. Typing it invites mistakes and numbers |
| Web Approved At | Derived | The proposal step records the time; the pull request and git history are the immutable record |
| Web Media Manifest | Derived | The manifest location follows from the listing id and the media base URL |
| Web Display Price (text) | Number | Matches the confirmed field type; a single AUD figure |
| Web Approved By (person or select) | Person only, plus an authorised-approver list | A person field is editable, so it is not authorisation on its own. The person's Notion user id must also be on approvers.json |
| Web Photo Folder (required pointer) | Optional | The website never reads it; it is only a human pointer |
| (new) | Web Title, Web Featured | Optional conveniences with safe defaults |

Net result: five required properties, one conditional and three optional, instead of twelve.
