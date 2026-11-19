import { checkPublicSafety, type SafetyContext } from './guards';
import { descriptionBlocks } from './description';
import { declareOptionalGroups } from './investment';
import { portfolioValuesHash, touchesVictoria } from './portfolio';
import { RESERVED_SLUGS, STATES, publicContentSchema, victorianClearance, type ApprovedSnapshot, type CommercialStatus, type ComplianceConfig, type Photo, type PublicContent } from './schema';
import { contentHash } from './versioning';

/*
  Turns a signed portfolio publication request into the public content of ONE portfolio listing, or says why it cannot. Pure: no file, network or Notion access.

  The request (built by the Listings Manager from the saved portfolio draft) carries only public-ready values: title, description, coverage line, the states of the member properties,
  the number of properties, how it is sold, the pricing mode and display price, lease and occupancy of the whole (only when approved), and the stated figures. It carries NO member
  address, CRM identifier or note. Nothing is added up or inferred here: figures are copied as stated. The approval hash is computed HERE from the values, so nothing about an approval
  is taken from the request. A Sold portfolio carries no figures. Every safety rule of an individual listing still runs afterwards (checkPublicSafety), plus the Victorian pricing clearance.
*/
interface FigureIn { kind: string; amount: number; basis: string; period: string; scope: string; count?: number | null }
export interface PortfolioRequestContent {
  title: string; description: string; coverage: string; states: string[]; propertyCount: number; saleMode: string; pricingMode: string; displayPrice: number | null; featured?: boolean;
  commercialStatus?: CommercialStatus;
  commercial?: { lease?: string; occupancy?: string; figures?: FigureIn[] };
}

const ZERO_HASH = '0'.repeat(64);
/** Letters and hyphens only (the site's slug rule): a portfolio slug comes from its title, with digits dropped. */
export const portfolioSlug = (title: string): string => {
  const base = title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/g, '');
  const s = base.length >= 3 ? base : 'property-portfolio';
  return /portfolio/.test(s) ? s : `${s}-portfolio`.slice(0, 80);
};

export interface BuildPortfolioInput {
  publicId: string;
  request: PortfolioRequestContent;
  photos: Photo[];
  previous: ApprovedSnapshot | null;
  /** slugs of every other approved listing, so a portfolio never takes another listing's address */
  otherSlugs: ReadonlySet<string>;
  status: CommercialStatus;
  ctx: SafetyContext;
  compliance?: ComplianceConfig;
}
export interface BuildPortfolioResult { content?: PublicContent; issues: string[] }

export const buildPortfolioContent = ({ publicId, request: r, photos, previous, otherSlugs, status, ctx, compliance }: BuildPortfolioInput): BuildPortfolioResult => {
  const issues: string[] = [];
  const states = [...new Set(r.states)].filter((s): s is (typeof STATES)[number] => (STATES as readonly string[]).includes(s));
  const slug = previous?.content.slug ?? portfolioSlug(r.title ?? '');
  if (RESERVED_SLUGS.includes(slug)) issues.push('this title would take an address reserved for a page of the website');
  if (otherSlugs.has(slug) && previous?.content.slug !== slug) issues.push('another listing already uses the web address this title would take; change the title');
  const description = descriptionBlocks(r.description ?? '');
  const sold = status === 'sold';
  const cm = r.commercial ?? {};
  const figures = sold ? [] : (cm.figures ?? []).map((f) => ({ kind: f.kind, amount: f.amount, basis: f.basis, period: f.period, scope: f.scope, ...(f.scope === 'some' ? { count: f.count } : {}) }));
  const vic = states.includes('VIC');
  const portfolio: Record<string, unknown> = {
    propertyCount: r.propertyCount, states, coverage: r.coverage, saleMode: r.saleMode,
    ...(!sold && cm.lease ? { leaseStatus: cm.lease } : {}), ...(!sold && cm.occupancy ? { occupancyStatus: cm.occupancy } : {}), ...(figures.length ? { figures } : {}),
  };
  if (figures.length || portfolio.leaseStatus || portfolio.occupancyStatus) {
    const approval: { valuesHash: string; victorian?: true } = { valuesHash: ZERO_HASH, ...(vic && figures.length ? { victorian: true as const } : {}) };
    approval.valuesHash = portfolioValuesHash({ figures: figures as never, leaseStatus: portfolio.leaseStatus as never, occupancyStatus: portfolio.occupancyStatus as never, approval });
    portfolio.approval = approval;
  }
  const declared = declareOptionalGroups(undefined, { description, state: vic ? 'VIC' : 'NT', status });
  const needsPrice = r.pricingMode === 'asking_price' || r.pricingMode === 'price_guide';
  const draft = {
    slug, type: 'portfolio', title: r.title, description,
    pricing: { mode: r.pricingMode, ...(needsPrice && r.displayPrice != null ? { display: `$${Math.round(r.displayPrice).toLocaleString('en-AU')}` } : {}) },
    sda: {}, photos, portfolio,
    ...(declared?.descriptionApproval ? { descriptionApproval: declared.descriptionApproval } : {}),
  };
  const parsed = publicContentSchema.safeParse(draft);
  if (!parsed.success) { for (const i of parsed.error.issues) issues.push(`${i.path.join('.') || 'content'}: ${i.message}`); return { issues }; }
  const content = parsed.data;
  if (photos.length < 1) issues.push('at least one approved photograph is required');
  if (touchesVictoria(content)) {
    const c = victorianClearance(compliance, publicId, content.pricing.mode);
    if (!c.cleared) issues.push(`Victorian pricing compliance is not cleared for "${content.pricing.mode}" (docs/victorian-pricing-compliance.md)`);
  }
  issues.push(...checkPublicSafety(content, ctx));
  return { content: issues.length ? undefined : content, issues };
};

/** The next approved snapshot of this portfolio. The approver is the constant identity: the person who acted is recorded only privately in the Listings Manager. */
export const nextPortfolioSnapshot = (publicId: string, content: PublicContent, previous: ApprovedSnapshot | null, opts: { status: CommercialStatus; featured: boolean; at: string }): ApprovedSnapshot => ({
  listingId: publicId,
  version: (previous?.version ?? 0) + 1,
  approvedBy: 'SDA Home Choices',
  approvedById: 'listings-manager',
  approvedAt: opts.at,
  firstPublishedAt: previous?.firstPublishedAt ?? opts.at,
  commercialStatus: opts.status,
  featured: opts.featured,
  contentHash: contentHash(content),
  content,
});
