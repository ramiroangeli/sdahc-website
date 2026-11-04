// Bundles a TypeScript entry with esbuild (already installed through Astro) and imports it, so
// plain Node scripts can reuse the exact modules the site uses without a second copy of the logic.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repoRoot = resolve(new URL('../..', import.meta.url).pathname);

export async function loadTs(entry = 'src/data/listings/lib.ts') {
  const dir = mkdtempSync(join(tmpdir(), 'sdahc-ts-'));
  const outfile = join(dir, 'bundle.mjs');
  await build({
    entryPoints: [resolve(repoRoot, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    // `import.meta.env` is a Vite feature; these scripts never rely on it
    define: { 'import.meta.env.DEV': 'false' },
    logLevel: 'error',
  });
  return import(pathToFileURL(outfile).href);
}
