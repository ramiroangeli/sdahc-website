import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://sdahomechoices.com.au',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
