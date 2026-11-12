# Search intent benchmark: Australian SDA buyer and investor queries

Purpose: a fixed list of realistic queries to map to the right page, spot genuine gaps and measure progress over time. It is not a keyword list for the site: no page is written to repeat these phrases, and no landing page is created per query.

Rules this benchmark follows (agreed scope):
- Transactional queries go towards actual opportunities. Educational queries go to research and advisory pages. Not every query points at a listing.
- Only existing pages are mapped as destinations. A gap is recorded, not filled automatically.
- Nothing on a destination page is invented to match a query: no price, income, yield, occupancy, demand or provider claim unless it is approved public content.
- Individual property pages are generated automatically from approved listing data. State, suburb and category are on them as facts, not as filler.

Destinations (all exist today): `Public listings` /opportunities/ · `Property page` /opportunities/&lt;slug&gt;/ · `Off-market` /opportunities/off-market/ · `Sales` /sda-property-and-portfolio-sales/ · `Divestment` /sda-strategic-divestment-advisory/ · `Portfolios` /buying-and-selling-sda-property-portfolios/ · `Report` /research/sda-market-report-2026/ · `Admin report` /research/sda-administration-report-2026/ · `Statistics` /sda-statistics/ · `State page` /research/sda-market-&lt;state&gt;/ · `About` /about/ · `Contact` /contact-us/

## 1. National property discovery

| # | Query | Best destination | Note |
|---|---|---|---|
| 1 | Where can I buy Specialist Disability Accommodation property in Australia? | Public listings | Transactional. Off-market linked from the page. |
| 2 | What completed SDA properties are currently for sale? | Public listings | Shows Available and Under offer with status. |
| 3 | SDA investment property for sale Australia | Public listings | |
| 4 | Where can I find SDA properties for sale? | Public listings, Off-market | Two paths: public and under NDA. |
| 5 | How do I buy an SDA property? | Report, Sales | Educational. |

## 2. State and regional discovery

| # | Query | Best destination | Note |
|---|---|---|---|
| 6 | Are there SDA properties for sale in Victoria? | Public listings (filter VIC), Property pages | Titles carry suburb, state and status. |
| 7 | SDA houses for sale in Shepparton | Property page | Exists only when a Shepparton listing is published. |
| 8 | Where can I buy SDA property near Geelong? | Public listings, VIC State page | Gap: no Geelong listing today. Do not create a Geelong page. |
| 9 | Are Improved Liveability SDA properties available in Armstrong Creek? | Property page | |
| 10 | SDA property for sale Queensland | Public listings, QLD State page | |
| 11 | SDA property for sale Northern Territory | Property page, NT State page | |
| 12 | Which state has the most SDA dwellings? | Statistics, State pages | Educational; answered with dated NDIA figures. |

## 3. SDA category and accommodation type

| # | Query | Best destination | Note |
|---|---|---|---|
| 13 | Where can I find High Physical Support SDA properties? | Public listings (design filter) | |
| 14 | Improved Liveability SDA properties for sale | Public listings, Property pages | Page titles include the category. |
| 15 | Robust SDA property for sale | Public listings, Property pages | |
| 16 | Fully Accessible SDA property for sale | Public listings | |
| 17 | What is the difference between High Physical Support and Improved Liveability? | Report | Educational. Gap: no short explainer page; do not create one only for this. |

## 4. Established versus development opportunities

| # | Query | Best destination | Note |
|---|---|---|---|
| 18 | Established SDA property for sale | Public listings | |
| 19 | Completed SDA house for sale with participants | Property pages, Off-market | Occupancy is shown only where approved. |
| 20 | SDA development opportunities Australia | Off-market, Sales | Gap: development stock is not published publicly. |
| 21 | Buy SDA off the plan | Report | Educational; no listing implied. |

## 5. Existing income, provider arrangements and investment risk

| # | Query | Best destination | Note |
|---|---|---|---|
| 22 | Can I buy an SDA investment with an existing provider arrangement? | Property pages (approved wording only), Off-market | Provider details are never published by default. |
| 23 | SDA property yield Australia | Report, Statistics | Educational only. No yield is stated for a property unless approved, and never on Victorian listings. |
| 24 | Is SDA a good investment? | Report | Educational. Not answered with property-level claims. |
| 25 | SDA investment risks | Report, Admin report | |
| 26 | What happens if an SDA provider fails? | Admin report | |

## 6. Buyer due diligence

| # | Query | Best destination | Note |
|---|---|---|---|
| 27 | What due diligence is required before buying an SDA house? | Report, Portfolios | Educational. |
| 28 | How do I check SDA enrolment and design category? | Report | |
| 29 | What does an SDA Information Memorandum include? | Off-market | |
| 30 | SDA property valuation | Portfolios | |

## 7. Portfolio acquisition and distressed assets

| # | Query | Best destination | Note |
|---|---|---|---|
| 31 | How do I find established SDA portfolios for sale? | Portfolios, Off-market | |
| 32 | Where can I find distressed SDA assets for acquisition? | Admin report, Divestment, Off-market | |
| 33 | SDA portfolio sale advisor | Sales, Portfolios | |
| 34 | Sell my SDA property | Sales | Vendor intent. |
| 35 | Should I sell my SDA property? | Divestment | |

## 8. SDAHC research and advisory expertise

| # | Query | Best destination | Note |
|---|---|---|---|
| 36 | Which brokers specialise in SDA investment property? | About, Sales | |
| 37 | SDA market report Australia | Report | |
| 38 | How many SDA dwellings are there in Australia? | Statistics | 13,779 enrolled as at 31 March 2026 (NDIA). |
| 39 | SDA market size by state | Statistics, State pages | |
| 40 | Who advises on strategic review of SDA assets? | Divestment | |

## Gaps (recorded, not filled automatically)
- No Geelong, Mount Barker or other suburb pages: only published listings have pages.
- No standalone explainers for the SDA design categories, or for development stock. The Market Report covers the categories.
- No public development opportunities. This is a stock position, not a content gap.

## How to measure
- **Search visibility:** Google Search Console and Bing Webmaster Tools. Track impressions and clicks per property page and per query group above; compare monthly.
- **Referrals and enquiries:** the listing enquiry form records the listing. Compare enquiries per property with visits (Vercel Analytics) and note the source.
- **AI citations:** where measurable, re-run these queries monthly in ChatGPT Search, Gemini, Claude, Perplexity and Copilot and note whether SDAHC pages are cited or linked. Record the date, the assistant and the cited URL. Citations cannot be guaranteed and are not a target in themselves.
- **Quality checks (automated):** every listing page has a unique title, a meta description of 160 characters or fewer, a canonical URL, a BreadcrumbList and structured data that contains no financial or tenancy field. See `scripts/test-listing-seo.mjs`.
