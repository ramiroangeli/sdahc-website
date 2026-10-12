// Central registry for SDA Home Choices research publications.
//
// Stable internal report IDs (sda2026, special, providers) must never be renamed: they are
// used end to end as the `report` form field / query parameter and as the server-side
// allowlist key in src/pages/api/report.ts, src/components/ReportGate.astro and
// src/pages/thank-you.astro. Extend this registry with new entries (e.g. a 2027 edition)
// rather than touching the components that consume it.
//
// `url` is each report's current public landing page. In this phase all three reports are
// hosted on the single existing /research/sda-market-report-2026/ page (the multi-cover
// showcase), so all three currently share that URL. When dedicated landing pages are built in
// a later phase, update each report's `url` here; nothing else needs to change.

export type ReportStatus = 'published' | 'coming-soon';
export type SubmissionMode = 'download' | 'preregistration';

export interface ReportCover {
  png: string;
  webp: string;
  width: number;
  height: number;
  alt: string;
}

export interface ReportPdf {
  href: string;
  filename: string;
  /** Label shown on the thank-you page's fallback download link ("download the {label} (PDF)").
   * Kept as an explicit string rather than derived from `title`/`fullTitle`, since existing copy
   * here spells "and" out in full while those use "&amp;": preserves the exact current text. */
  downloadLabel: string;
}

export interface ReportConfig {
  id: string;
  /** Short public title, used on the cover caption and in headings. */
  title: string;
  /** Full report name, used in email subjects and notification copy. */
  fullTitle: string;
  /** Accessible name for the cover's open-form button. Kept as an explicit string rather than
   * derived from `title`, since existing copy spells "and" out in full here while the visible
   * title uses "&amp;": preserves the exact current accessible name. */
  ariaLabel: string;
  url: string;
  year: number;
  status: ReportStatus;
  description: string;
  cover: ReportCover;
  /** Present only when a PDF exists and may be publicly delivered. Must stay absent for any
   * report that should not expose a download (e.g. providers in this phase). */
  pdf?: ReportPdf;
  mode: SubmissionMode;
  thankYou: {
    successUrl: string;
  };
}

export const REPORTS: Record<string, ReportConfig> = {
  sda2026: {
    id: 'sda2026',
    title: 'SDA Report 2026',
    fullTitle: 'SDA Market Report 2026',
    ariaLabel: 'Open the SDA Report 2026 download form',
    url: '/research/sda-market-report-2026/',
    year: 2026,
    status: 'published',
    description: "SDAHC Research's flagship annual report: supply, demand, pricing and investment context across Australia.",
    cover: {
      png: '/images/reports/report-sda-2026.png',
      webp: '/images/reports/report-sda-2026.webp',
      width: 1122,
      height: 1402,
      alt: 'SDA Report 2026 cover',
    },
    pdf: {
      href: '/sda-market-report-2026.pdf',
      filename: 'SDA-Market-Report-2026.pdf',
      downloadLabel: 'SDA Market Report 2026',
    },
    mode: 'download',
    thankYou: { successUrl: '/thank-you/?report=sda2026' },
  },
  special: {
    id: 'special',
    title: 'SDA Administration & Special Situations Report',
    fullTitle: 'SDA Administration & Special Situations Report',
    ariaLabel: 'Open the SDA Administration and Special Situations Report download form',
    url: '/research/sda-market-report-2026/',
    year: 2026,
    status: 'published',
    description: 'A dedicated commercial reference for administration and special situations in the SDA sector.',
    cover: {
      png: '/images/reports/report-special-situations.png',
      webp: '/images/reports/report-special-situations.webp',
      width: 1122,
      height: 1402,
      alt: 'SDA Administration and Special Situations Report cover',
    },
    pdf: {
      href: '/sda-administration-special-situations-report-2026.pdf',
      filename: 'SDA-Administration-and-Special-Situations-Report-2026.pdf',
      downloadLabel: 'SDA Administration and Special Situations Report',
    },
    mode: 'download',
    thankYou: { successUrl: '/thank-you/?report=special' },
  },
  providers: {
    id: 'providers',
    title: 'SDA Providers Report',
    fullTitle: 'SDA Providers Report',
    ariaLabel: 'Open the SDA Providers Report registration form',
    url: '/research/sda-market-report-2026/',
    year: 2026,
    status: 'coming-soon',
    description: 'A dedicated report for SDA providers. Coming soon.',
    cover: {
      png: '/images/reports/report-providers.png',
      webp: '/images/reports/report-providers.webp',
      width: 1122,
      height: 1402,
      alt: 'SDA Providers Report cover',
    },
    // No pdf entry: no file exists yet, and none should be exposed publicly in this phase.
    mode: 'preregistration',
    thankYou: { successUrl: '/thank-you/?report=providers' },
  },
};

/** Every known report ID, for the server-side allowlist in /api/report. */
export const REPORT_IDS = Object.keys(REPORTS);

/** Reports whose cover should render as an interactive, clickable gate. */
export const PUBLISHED_REPORT_IDS = REPORT_IDS.filter((id) => REPORTS[id].status === 'published');
