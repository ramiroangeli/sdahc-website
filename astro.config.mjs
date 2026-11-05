import { defineConfig } from 'astro/config';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

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
  integrations: [sitemap(), localPreviewMedia],
});
