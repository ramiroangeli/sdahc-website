import { defineConfig } from 'astro/config';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

// Last-changed date per page (path -> YYYY-MM-DD). Shared with src/data/seo.ts so the sitemap
// <lastmod> and the visible "Updated" lines come from the same place.
const pageDates = JSON.parse(readFileSync(new URL('./src/data/page-dates.json', import.meta.url), 'utf8'));

// Last approval time of each published listing (slug -> ISO time), from its approved snapshot. A listing page's <lastmod> is when its public content
// last changed. A withdrawn listing has no page, so it never reaches the sitemap.
const listingDir = new URL('./src/data/listings/approved/', import.meta.url);
const listingDates = Object.fromEntries(readdirSync(listingDir).filter((f) => f.endsWith('.json')).map((f) => {
  const s = JSON.parse(readFileSync(new URL(f, listingDir), 'utf8'));
  return [`/opportunities/${s.content.slug}/`, s.approvedAt];
}));

// Utility pages that should never appear in the sitemap (they are also marked noindex).
const EXCLUDED = ['/thank-you/'];

// Local draft preview only (npm run dev:preview): serves .local-preview/media/ at /__local-preview__/.
// It exists only on the dev server and only with LISTINGS_LOCAL_PREVIEW=1, so it is not part of any build.
const localPreviewMedia = {
  name: 'local-preview-media',
  hooks: {
    'astro:server:setup': ({ server }) => {
      if (process.env.LISTINGS_LOCAL_PREVIEW !== '1') return;
      const root = join(process.cwd(), '.local-preview', 'media');
      server.middlewares.use('/__local-preview__', (req, res, next) => {
        const file = normalize(join(root, decodeURIComponent((req.url ?? '').split('?')[0])));
        if (!file.startsWith(root) || !existsSync(file) || extname(file) !== '.webp') return next();
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  },
};

export default defineConfig({
  site: 'https://sdahomechoices.com.au',
  trailingSlash: 'always',
  build: { format: 'directory' },
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => !EXCLUDED.includes(new URL(page).pathname),
      serialize(item) {
        const path = new URL(item.url).pathname;
        const date = pageDates[path];
        if (date) item.lastmod = new Date(`${date}T00:00:00Z`).toISOString();
        else if (listingDates[path]) item.lastmod = new Date(listingDates[path]).toISOString();
        return item;
      },
    }),
    localPreviewMedia,
  ],
});
