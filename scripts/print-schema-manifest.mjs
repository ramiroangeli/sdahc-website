#!/usr/bin/env node
/*
  Generates docs/notion-schema-manifest.md and docs/notion-schema-manifest.json from the adapter itself
  (WEB_SCHEMA), so the proposal for Notion can never drift from the code that reads it.

    node scripts/print-schema-manifest.mjs            print the markdown
    node scripts/print-schema-manifest.mjs --write    rewrite both files in docs/
*/
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

const L = await loadTs();

export const manifestJson = () => ({
  database: 'Properties',
  note: 'Properties to ADD to the existing Properties database. Nothing existing is renamed, removed or edited.',
  apiVersion: L.NOTION_VERSION,
  properties: L.WEB_SCHEMA.map((w) => ({ name: w.name, type: w.type, ...(w.options ? { options: w.options } : {}), required: w.required, defaultBehaviour: w.defaultBehaviour, mapsTo: w.mapsTo })),
  derivedNotCreated: [
    { name: 'slug', from: 'Web Public Address', rule: 'letters and hyphens only; a letter suffix if another property shares the street; frozen once published' },
    { name: 'approval time', from: 'the proposal step', rule: 'the moment the snapshot is proposed; git history is the record' },
    { name: 'photo manifest location', from: 'public listing id', rule: '<LISTINGS_MEDIA_BASE_URL>/<public id>/manifest.json' },
    { name: 'public listing id', from: 'Notion page id', rule: 'lst_ + first 10 hex characters of the SHA-256 of the page id' },
  ],
});

export const manifestMarkdown = () => {
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  const rows = L.WEB_SCHEMA.map((w, i) => `| ${i + 1} | ${w.name} | ${w.type === 'rich_text' ? 'Text (rich_text)' : w.type === 'people' ? 'Person (people)' : w.type === 'number' ? 'Number' : w.type === 'select' ? 'Select' : w.type === 'checkbox' ? 'Checkbox' : 'URL'} | ${w.options ? cell(w.options.join(', ')) : ''} | ${cell(w.required)} | ${cell(w.defaultBehaviour)} | ${cell(w.mapsTo)} |`).join('\n');
  return `# Notion schema manifest: Web properties

Generated from the adapter by \`node scripts/print-schema-manifest.mjs --write\`. **Do not edit by hand**; a test fails if this file differs from the code.

Add these ${L.WEB_SCHEMA.length} properties to the existing **Properties** database (data source \`2e2909c1-bb60-8177-bf4f-000b40ef0d48\`). Nothing existing is renamed, removed or edited, and no record is changed. API version \`${L.NOTION_VERSION}\`.

| # | Property | Notion type | Select options | Required | Default publication behaviour | Mapping into the public snapshot |
|---|---|---|---|---|---|---|
${rows}

## Derived, so not created in Notion

${manifestJson().derivedNotCreated.map((d) => `- **${d.name}**, from ${d.from}: ${d.rule}`).join('\n')}

## How these nine differ from the earlier twelve-field proposal

| Earlier proposal | Now | Why |
|---|---|---|
| Web Slug | Derived | The slug is generated from the public address and frozen at first publication. Typing it invites mistakes and numbers |
| Web Approved At | Derived | The proposal step records the time; the pull request and git history are the immutable record |
| Web Media Manifest | Derived | The manifest location follows from the listing id and the media base URL |
| Web Display Price (text) | Number | Matches the confirmed field type; a single AUD figure |
| Web Approved By (person or select) | Person only, plus an authorised-approver list | A person field is editable, so it is not authorisation on its own. The person's Notion user id must also be on approvers.json |
| Web Photo Folder (required pointer) | Optional | The website never reads it; it is only a human pointer |
| (new) | Web Title, Web Featured | Optional conveniences with safe defaults |

Net result: five required properties, one conditional and three optional, instead of twelve.
`;
};

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  if (process.argv.includes('--write')) {
    writeFileSync(join(repoRoot, 'docs/notion-schema-manifest.md'), manifestMarkdown());
    writeFileSync(join(repoRoot, 'docs/notion-schema-manifest.json'), `${JSON.stringify(manifestJson(), null, 2)}\n`);
    console.log('Wrote docs/notion-schema-manifest.md and docs/notion-schema-manifest.json');
  } else console.log(manifestMarkdown());
}
