import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

// Last-changed date per page (path -> YYYY-MM-DD). Shared with src/data/seo.ts so the sitemap
// <lastmod> and the visible "Updated" lines come from the same place.
const pageDates = JSON.parse(readFileSync(new URL('./src/data/page-dates.json', import.meta.url), 'utf8'));

// Utility pages that should never appear in the sitemap (they are also marked noindex).
const EXCLUDED = ['/thank-you/'];

export default defineConfig({
  site: 'https://sdahomechoices.com.au',
  trailingSlash: 'always',
  build: { format: 'directory' },
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => !EXCLUDED.includes(new URL(page).pathname),
      serialize(item) {
        const date = pageDates[new URL(item.url).pathname];
        if (date) item.lastmod = new Date(`${date}T00:00:00Z`).toISOString();
        return item;
      },
    }),
  ],
});
