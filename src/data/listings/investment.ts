import { createHash } from 'node:crypto';
import { LEASE_LABEL, OCCUPANCY_LABEL, type CommercialStatus, type Investment, type OptionalGroups, type PublicAddress } from './schema';

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

/**
 * The Publisher's declaration replaces the separate commercial and Victorian approvals for a request that is signed, authenticated and carries a verified
 * declaration (scripts/lib/publish-job.mjs, verifyDeclaration). It turns the optional groups the request carried into the groups the snapshot stores: the
 * values hash is computed here from the values themselves, so nothing about an approval is ever taken from the request. Pure.
 *   - A Sold listing carries no commercial block and no description approval (a sold property is not offered), so commercial wording must be edited out.
 *   - Any approval record or hash in the request is discarded and recomputed.
 *   - Victoria: income and yield travel under the declaration (the stored flag records that they were published under it, not a legal classification).
 * Every other protection (private address, CRM price and yield, links, email, phone, participant names, images, pricing compliance) still runs afterwards.
 */
export const declareOptionalGroups = (
  optional: OptionalGroups | undefined | null,
  ctx: { description: readonly string[]; state: string; status: CommercialStatus },
): OptionalGroups | undefined => {
  const out: Record<string, unknown> = { ...(optional ?? {}) };
  delete out.descriptionApproval;
  const sold = ctx.status === 'sold';
  if (sold) delete out.investment;
  else if (out.investment) {
    const { approval: _discarded, ...values } = out.investment as Investment;
    const vic = ctx.state === 'VIC' && hasFinancialFigures(values);
    const approval: Investment['approval'] = { valuesHash: '0'.repeat(64), ...(values.providerArrangement ? { provider: true as const } : {}), ...(vic ? { victorian: true as const } : {}) };
    approval.valuesHash = investmentValuesHash({ ...values, approval });
    out.investment = { ...values, approval };
  }
  if (!sold && findFinancialMentionsIn(ctx.description)) {
    out.descriptionApproval = { textHash: descriptionApprovalHash(ctx.description, out.investment as Investment | undefined), ...(ctx.state === 'VIC' ? { victorian: true as const } : {}) };
  }
  return Object.keys(out).length ? (out as OptionalGroups) : undefined;
};

// must stay identical to MONEY in guards.ts (guards.ts imports this module, so it cannot be imported back); a test compares them
export const FINANCIAL_WORDING = /\$\s?\d|\b\d[\d,]*\s?(?:aud|dollars)\b|\b(?:yield|cap rate|rental income|net rent|gross rent|noi|roi|return on investment)\b/i;
const findFinancialMentionsIn = (blocks: readonly string[]): boolean => FINANCIAL_WORDING.test(blocks.join('\n'));
