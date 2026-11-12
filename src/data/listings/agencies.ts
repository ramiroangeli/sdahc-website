import registry from './agencies.json';

/*
  Approved marketing agencies. Deliberately tiny: a key, a display name and two brand files that already live in src/assets. Adding an agency is a
  reviewed code-owner pull request. There is no agent database, no profile page and no destination link yet. A listing names its agency with
  marketing.agency; without it the default (SDA Home Choices) applies, so every existing listing is unchanged.
*/
export interface Agency { key: string; name: string; /** file in src/assets, for light backgrounds */ logo: string; /** file in src/assets, for dark backgrounds */ logoOnDark: string }

export const AGENCIES: Agency[] = registry.agencies;
export const DEFAULT_AGENCY_KEY: string = registry.default;
export const isApprovedAgency = (key: string): boolean => AGENCIES.some((a) => a.key === key);
/** The agency for a listing. An unknown key falls back to the default, so a page can never render an agency that is not in the registry. */
export const agencyFor = (key?: string): Agency => AGENCIES.find((a) => a.key === (key ?? DEFAULT_AGENCY_KEY)) ?? AGENCIES.find((a) => a.key === DEFAULT_AGENCY_KEY)!;
