import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://sdahomechoices.com.au',
  trailingSlash: 'always',
  build: { format: 'directory' },
  adapter: vercel(),
  integrations: [sitemap()],
});