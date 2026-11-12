import { createHash } from 'node:crypto';
import { LEASE_LABEL, OCCUPANCY_LABEL, type CommercialStatus, type Investment, type PublicAddress } from './schema';

/*
  The optional commercial block, and the ONE place that decides what of it a visitor may see.

  Hash: `investmentValuesHash` covers every value in the block except `approval` itself, over sorted keys, so the approval is bound to the exact values.
  A changed value without a fresh approval no longer matches (see guards.ts). The hash proves the values were not altered after they were approved
  in the Listings Manager; who approved them is private audit history and is never part of public content.

  View: `publicInvestment` turns the block into labelled rows for the page and returns null whenever nothing may be shown:
    - no block, or an approval that does not match the values;
    - a Sold listing (a sold property is not offered, so it carries no commercial figures);
    - Victoria: income and yield are not shown unless a Publisher recorded a business authorisation for these exact values (approval.victorian, for
      example an existing public advertisement). That is not a legal classification and does not settle the advertising obligations, which remain
      with the OIEC or a legal adviser. Lease and occupancy status are shown there when approved.
  Nothing is inferred: lease status and occupancy status are separate rows, and either is shown only if it was approved. Provider wording is shown only
  with its own authorisation. Yield is never calculated here.
*/
const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);

export const investmentValuesHash = (inv: Investment): string => {
  const { approval, ...values } = inv;
  // The Victorian business authorisation is part of what was approved, so it is bound into the hash. Without it the input is exactly the values, so every
  // hash made before this existed is unchanged.
  const input = approval?.victorian === true ? { ...values, __victorianBusinessAuthorisation: true } : values;
  return createHash('sha256').update(JSON.stringify(sortKeys(input))).digest('hex');
};
export const investmentApprovalValid = (inv: Investment): boolean => investmentValuesHash(inv) === inv.approval.valuesHash;
/** A Victorian listing may show income and yield only when a Publisher recorded a business authorisation for these exact values. It is not a legal classification. */
export const victorianAuthorised = (inv: Investment): boolean => inv.approval.victorian === true && investmentApprovalValid(inv);

/**
 * The approval of an exact description that carries commercial wording (income, yield, occupancy, provider arrangements). The hash covers the whole
 * description (every block, in order) and the structured commercial values, so a change to either invalidates it. Who approved it, and the source of
 * the authorisation, stay private in the Listings Manager.
 */
export const descriptionApprovalHash = (description: readonly string[], investment?: Investment): string => {
  const values = investment ? (({ approval: _a, ...v }) => v)(investment) : null;
  return createHash('sha256').update(JSON.stringify(sortKeys({ description, investment: values }))).digest('hex');
};

export const VICTORIAN_FINANCIAL_RESTRICTION = 'Income and yield are not published on Victorian listings until the advertising obligations are confirmed.';
export const hasFinancialFigures = (inv: Pick<Investment, 'annualIncomeAud' | 'yieldPct' | 'incomeType' | 'yieldType'>): boolean =>
  inv.annualIncomeAud !== undefined || inv.yieldPct !== undefined || inv.incomeType !== undefined || inv.yieldType !== undefined;

export interface InvestmentView {
  lease?: { key: string; label: string };
  occupancy?: { key: string; label: string };
  tenure?: string;
  income?: { amountAud: number; label: string; basis: 'Actual' | 'Projected' };
  yield?: { pct: number; text: string; label: string; basis: 'Actual' | 'Projected' };
  provider?: string;
}

export const formatYield = (pct: number): string => `${pct.toFixed(1)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const publicInvestment = (l: { address: Pick<PublicAddress, 'state'>; commercialStatus: CommercialStatus; investment?: Investment }): InvestmentView | null => {
  const inv = l.investment;
  if (!inv || l.commercialStatus === 'sold' || !investmentApprovalValid(inv)) return null;
  const vic = l.address.state === 'VIC';
  const basis = inv.basis ? cap(inv.basis) as 'Actual' | 'Projected' : undefined;
  const view: InvestmentView = {};
  if (inv.leaseStatus) view.lease = { key: inv.leaseStatus, label: LEASE_LABEL[inv.leaseStatus] };
  if (inv.occupancyStatus) view.occupancy = { key: inv.occupancyStatus, label: OCCUPANCY_LABEL[inv.occupancyStatus] };
  if (inv.tenure) view.tenure = inv.tenure;
  if ((!vic || victorianAuthorised(inv)) && basis) {
    if (inv.annualIncomeAud !== undefined && inv.incomeType) view.income = { amountAud: inv.annualIncomeAud, label: `${cap(inv.incomeType)} annual income`, basis };
    if (inv.yieldPct !== undefined && inv.yieldType) view.yield = { pct: inv.yieldPct, text: formatYield(inv.yieldPct), label: `${cap(inv.yieldType)} yield`, basis };
  }
  if (inv.providerArrangement && inv.approval.provider === true) view.provider = inv.providerArrangement;
  return Object.keys(view).length ? view : null;
};
