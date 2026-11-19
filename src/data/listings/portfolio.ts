import { createHash } from 'node:crypto';
import { PORTFOLIO_FIGURE_LABEL, PORTFOLIO_SALE_LABEL, LEASE_LABEL, OCCUPANCY_LABEL, STATES, type PublicContent, type State } from './schema';

/*
  Property portfolios on the public site. ONE listing for several properties sold together.

  What may be public: a title, a coverage line (for example "Berrimah, Northern Territory"), the states it covers, how many properties it has, how it is sold, the approved
  price display, and the figures a Publisher approved. What is never public: any member's address, any CRM identifier, internal classification, notes.
  Nothing is added up, averaged or inferred. Each figure keeps its own basis (Actual or Projected), period and coverage ("All 3 properties", "2 of 3 properties").
  Lease and occupancy of the whole appear only when approved. A Victorian portfolio shows income and yield only under the business authorisation flag, like an individual listing.
*/
type PortfolioBlock = NonNullable<PublicContent['portfolio']>;
type Figure = NonNullable<PortfolioBlock['figures']>[number];

const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);

/** Binds the approval to the exact values (figures, lease, occupancy) and, when present, the Victorian authorisation. */
export const portfolioValuesHash = (p: Pick<PortfolioBlock, 'figures' | 'leaseStatus' | 'occupancyStatus' | 'approval'>): string => {
  const values = { figures: p.figures ?? [], leaseStatus: p.leaseStatus ?? null, occupancyStatus: p.occupancyStatus ?? null, ...(p.approval?.victorian === true ? { __victorianBusinessAuthorisation: true } : {}) };
  return createHash('sha256').update(JSON.stringify(sortKeys(values))).digest('hex');
};
export const portfolioApprovalValid = (p: PortfolioBlock): boolean => !!p.approval && portfolioValuesHash(p) === p.approval.valuesHash;
export const hasPortfolioFigures = (p: PortfolioBlock): boolean => (p.figures ?? []).length > 0;

export const isPortfolio = (l: { type: string }): boolean => l.type === 'portfolio';
type Placed = { address?: { state: State }; portfolio?: { states: readonly State[] } };
/** The states a listing covers: its address state, or the states of a portfolio. */
export const listingStates = (l: Placed): State[] => (l.address ? [l.address.state] : [...(l.portfolio?.states ?? [])]);
export const touchesVictoria = (l: Placed): boolean => listingStates(l).includes('VIC');

export interface PortfolioFigureView { label: string; value: string; basis: 'Actual' | 'Projected'; period: string; coverage: string }
const money = (n: number) => `$${n.toLocaleString('en-AU')}`;
export const coverageText = (f: Figure, count: number): string => (f.scope === 'all' ? `All ${count} properties` : `${f.count} of ${count} properties`);

export interface PortfolioView {
  count: number; countLabel: string; coverage: string; states: State[]; saleLabel: string;
  lease?: string; occupancy?: string; figures: PortfolioFigureView[];
}
/** The one place that decides what of a portfolio's commercial block a visitor may see. A sold portfolio shows none. */
export const portfolioView = (l: { portfolio?: PortfolioBlock; commercialStatus?: string }): PortfolioView | null => {
  const p = l.portfolio; if (!p) return null;
  const claims = hasPortfolioFigures(p) || !!p.leaseStatus || !!p.occupancyStatus;
  const show = l.commercialStatus !== 'sold' && (!claims || portfolioApprovalValid(p));
  const vic = p.states.includes('VIC');
  const figures: PortfolioFigureView[] = [];
  if (show && (!vic || p.approval?.victorian === true)) {
    for (const f of p.figures ?? []) {
      figures.push({ label: PORTFOLIO_FIGURE_LABEL[f.kind], value: f.kind.endsWith('_pct') ? `${f.amount.toFixed(1)}%` : money(f.amount), basis: f.basis === 'actual' ? 'Actual' : 'Projected', period: f.period, coverage: coverageText(f, p.propertyCount) });
    }
  }
  return {
    count: p.propertyCount, countLabel: `${p.propertyCount} properties`, coverage: p.coverage, states: [...p.states].sort((a, b) => STATES.indexOf(a) - STATES.indexOf(b)), saleLabel: PORTFOLIO_SALE_LABEL[p.saleMode],
    ...(show && p.leaseStatus ? { lease: LEASE_LABEL[p.leaseStatus] } : {}), ...(show && p.occupancyStatus ? { occupancy: OCCUPANCY_LABEL[p.occupancyStatus] } : {}), figures,
  };
};
