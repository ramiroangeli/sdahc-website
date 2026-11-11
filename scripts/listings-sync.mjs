#!/usr/bin/env node
/*
  Listing publication tool. READ ONLY toward Notion: it never creates, updates or archives anything there.

  The website never contacts Notion. It builds only from files committed in git:
    src/data/listings/approved/<slug>.json   the last approved public version of a listing
    src/data/listings/withdrawn/<id>.json    an explicit withdrawal
  So three things are deliberately separate:
    1. SYNCHRONISATION   this tool reads Notion and PROPOSES a snapshot (files on a branch)
    2. APPROVAL          a person reviews the pull request; the snapshot is only live once it is merged
    3. DEPLOYMENT        the normal Vercel deployment of main

  Commands (see docs/listings-runbook.md):
    --doctor [--online]              check the local configuration without printing any secret: which variables
                                     are set, whether the ids are valid, and with --online whether Notion accepts
                                     the token and can read the data source (read only)
    --schema                         compare the real data source with what the adapter expects and print the
                                     exact Notion changes still needed (read only)
    --preflight <pageId>             publication readiness report for one Properties row
      --from-file page.json          ...from an exported page, with no Notion credentials
    --propose [--write]              build proposed snapshots from rows with a live status (dry run by default;
                                     --write refuses to run on main or master)
    --withdraw <id|slug> [--dry-run]  hide a listing now, WITHOUT Notion (emergency withdrawal). The file is committed to a PUBLIC
                                     repository, so it never carries a reason or a name; record those privately (Listings Manager)
    --reinstate <id>                 remove a withdrawal

  A row is proposed only when: its status is Published, Under Offer or Sold; a named approver is set AND
  that person's Notion user id is on src/data/listings/approvers.json (default deny); it has a valid public
  address, description and pricing; it has real photographs with alt text and a recorded privacy review;
  and every safety check passes. If anything fails, nothing is written for that row.

  Environment (never commit values; use .env.listings, which is git-ignored, via `npm run listings:*`):
    NOTION_TOKEN                        read-only integration token. Never printed.
    NOTION_PROPERTIES_DATA_SOURCE_ID    the data source UUID (collection://<uuid> is accepted and stripped)
    NOTION_API_VERSION                  optional override of the pinned version
    LISTINGS_MEDIA_BASE_URL             public origin of the photo store (needed to propose and preflight photos)
*/
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const val = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : undefined; };
const write = has('--write');

// LISTINGS_DATA_DIR exists so tests can run the real commands against a temporary directory
const dataDir = process.env.LISTINGS_DATA_DIR ?? join(repoRoot, 'src/data/listings');
const approvedDir = join(dataDir, 'approved');
const withdrawnDir = join(dataDir, 'withdrawn');
const mediaBase = process.env.LISTINGS_MEDIA_BASE_URL;

const readJsonDir = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) })) : [];
// approvers.json and compliance.json live beside the data; LISTINGS_DATA_DIR (tests only) points all of it at a temporary folder
const compliance = () => JSON.parse(readFileSync(join(dataDir, 'compliance.json'), 'utf8'));
const approverIds = () => JSON.parse(readFileSync(join(dataDir, 'approvers.json'), 'utf8')).approvers.map((a) => a.notionUserId);
const currentBranch = () => { try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { return ''; } };

const L = await loadTs();

/* ---------------------------------------------------------------- offline commands */

if (has('--withdraw')) {
  const target = val('--withdraw');
  if (!target) { console.error('usage: --withdraw <id|slug> [--dry-run]'); process.exit(2); }
  // the file is committed to a PUBLIC repository: no free-text reason and no person's name, ever. A --reason or --by given out of habit is NOT stored.
  if (val('--reason') !== undefined || val('--by') !== undefined) console.log('Note: --reason and --by are not stored. The withdrawal file is public; record the reason and who acted privately (the Listings Manager audit trail or your own records).');
  const snap = readJsonDir(approvedDir).map((x) => x.data).find((s) => s.listingId === target || s.content.slug === target);
  if (!snap) { console.error(`No approved listing found for "${target}".`); process.exit(1); }
  const w = { listingId: snap.listingId, withdrawnAt: new Date().toISOString(), withdrawnBy: 'SDA Home Choices', reason: 'withdrawn' };
  console.log(`${has('--dry-run') ? 'Would withdraw' : 'Withdrawing'} ${snap.content.slug} (${snap.listingId})`);
  if (!has('--dry-run')) {
    mkdirSync(withdrawnDir, { recursive: true });
    writeFileSync(join(withdrawnDir, `${snap.listingId}.json`), `${JSON.stringify(w, null, 2)}\n`);
    console.log('Written. Now: commit, push, and deploy it (see "Emergency withdrawal" in docs/listings-runbook.md).');
    console.log(`Then verify the build with: npm run check:withdrawal -- ${snap.content.slug}`);
  }
  process.exit(0);
}

if (has('--reinstate')) {
  const id = val('--reinstate');
  const f = join(withdrawnDir, `${id}.json`);
  if (!id || !existsSync(f)) { console.error(`No withdrawal found for "${id}".`); process.exit(1); }
  rmSync(f);
  console.log(`Removed the withdrawal for ${id}. Commit it through a reviewed pull request; the listing returns on the next deployment.`);
  process.exit(0);
}

const printReport = (rep) => {
  const mark = { ready: 'READY', missing: 'MISSING', needs_approval: 'APPROVE', protected: 'PROTECTED', info: 'info' };
  for (const r of rep.rows) console.log(`  ${mark[r.status].padEnd(9)} ${r.item}: ${r.note}`);
  console.log('');
};

if (has('--preflight') && has('--from-file')) {
  const page = JSON.parse(readFileSync(val('--from-file'), 'utf8'));
  console.log(`Preflight (offline) for ${val('--preflight')}, public id ${L.publicIdFor(page.id)}\n`);
  printReport(L.readinessReport(page, { mediaBaseUrl: mediaBase, authorisedApproverIds: approverIds(), compliance: compliance() }));
  process.exit(0);
}

/* ---------------------------------------------------------------- doctor */

if (has('--doctor')) {
  const ok = (m) => console.log(`  ok       ${m}`);
  const bad = (m) => { console.log(`  MISSING  ${m}`); failed = true; };
  const info = (m) => console.log(`  info     ${m}`);
  let failed = false;
  console.log('Notion integration check. Nothing is printed that could be a secret, and nothing is changed.\n');

  const tok = process.env.NOTION_TOKEN;
  if (!tok) bad('NOTION_TOKEN is not set. Put it in .env.listings (git-ignored), never in a committed file.');
  else if (!/^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(tok)) bad('NOTION_TOKEN is set but does not look like a Notion integration token (expected the ntn_ or secret_ prefix).');
  else ok('NOTION_TOKEN is set and has the shape of a Notion integration token (value not shown)');

  const dsRaw = process.env.NOTION_PROPERTIES_DATA_SOURCE_ID;
  let cfgOk = null;
  if (!dsRaw) bad('NOTION_PROPERTIES_DATA_SOURCE_ID is not set. Use the DATA SOURCE id, not the database id.');
  else {
    try {
      cfgOk = L.readNotionConfig({ ...process.env, NOTION_TOKEN: tok || 'x' });
      ok(`data source id is a valid UUID (${cfgOk.dataSourceId.slice(0, 8)}...) and is not the database id; collection:// would be converted`);
    } catch (e) { bad(e.message); }
  }
  ok(`API version ${process.env.NOTION_API_VERSION || L.NOTION_VERSION}${process.env.NOTION_API_VERSION ? ' (overridden)' : ' (pinned in the repository)'}`);
  if (process.env.LISTINGS_MEDIA_BASE_URL) ok('LISTINGS_MEDIA_BASE_URL is set'); else info('LISTINGS_MEDIA_BASE_URL is not set yet (needed to preflight photographs and to propose a listing)');
  const approvers = approverIds();
  if (approvers.length) ok(`${approvers.length} authorised approver(s) in approvers.json`); else info('approvers.json is empty: nobody can approve a listing yet');

  if (has('--online')) {
    if (!cfgOk || !tok) bad('--online needs a valid token and data source id first');
    else {
      try {
        const client = new L.NotionReadClient(cfgOk);
        await client.retrieveSelf();
        ok('Notion accepted the token (GET /v1/users/me)');
        const ds = await client.retrieveDataSource();
        const c = L.checkDataSourceSchema(ds);
        ok('the integration can read the data source (it is shared with the integration)');
        if (c.isValidatedDatabase) ok('existing CRM properties are all present with the expected types');
        else bad(`existing CRM properties do not match: ${[...c.missingCore.map((n) => `${n} missing`), ...c.wrongCoreType.map((w) => `${w.name} is ${w.actual}`)].join('; ')}. Is this the right "Properties" database?`);
        if (c.toAdd.length) info(`${c.toAdd.length} Web properties still to create (run: npm run listings:schema)`); else ok('all Web properties exist');
      } catch (e) { bad(`Notion check failed: ${e.message}`); }
    }
  } else if (cfgOk && tok) info('run with --online to ask Notion whether the token works and can read the data source');

  if (failed) {
    console.log(`
Minimum setup (details: docs/listings-runbook.md, section 1):
  1. Notion, Settings, Connections: create an INTERNAL integration with ONLY "Read content".
  2. On the Properties database: ... menu, Connections, add that integration (only this database).
  3. Create .env.listings with NOTION_TOKEN and NOTION_PROPERTIES_DATA_SOURCE_ID.
  4. Run: npm run listings:doctor -- --online`);
  }
  process.exit(failed ? 1 : 0);
}

/* ---------------------------------------------------------------- Notion commands (read only) */

let cfg;
try { cfg = L.readNotionConfig(process.env); } catch (e) { console.error(`listings-sync: ${e.message}`); process.exit(1); }
if (!cfg) {
  console.error('listings-sync: NOTION_TOKEN and NOTION_PROPERTIES_DATA_SOURCE_ID are not set. See docs/listings-runbook.md (section "Read-only Notion setup").');
  process.exit(1);
}

try {
  const client = new L.NotionReadClient(cfg);
  console.log(`Notion API version ${cfg.version}, data source ${cfg.dataSourceId}`);

  if (has('--schema')) {
    const ds = await client.retrieveDataSource();
    const c = L.checkDataSourceSchema(ds);
    console.log(c.isValidatedDatabase ? 'Existing CRM properties: all present with the expected types.' : 'Existing CRM properties: PROBLEMS');
    for (const m of c.missingCore) console.log(`  MISSING  ${m}`);
    for (const w of c.wrongCoreType) console.log(`  TYPE     ${w.name}: expected ${w.expected}, found ${w.actual}`);
    if (c.unmappedDesignOptions.length) console.log(`  Design Category options that are not published as an SDA category: ${c.unmappedDesignOptions.join(', ')}`);
    if (c.unmappedStateOptions.length) console.log(`  State/ Territory options not recognised as state codes: ${c.unmappedStateOptions.join(', ')}`);
    console.log(`\nWeb properties still to add (${c.toAdd.length}):`);
    for (const a of c.toAdd) console.log(`  + ${a.name}  [${a.type}${a.options ? `: ${a.options.join(' | ')}` : ''}]  ${a.required}. ${a.note}`);
    for (const w of c.wrongWebType) console.log(`  TYPE     ${w.name}: expected ${w.expected}, found ${w.actual}`);
    for (const m of c.missingSelectOptions) console.log(`  OPTIONS  ${m.name} lacks: ${m.missing.join(', ')}`);
    console.log('\nNothing was changed in Notion.');
    process.exit(c.isValidatedDatabase && !c.wrongWebType.length ? 0 : 1);
  }

  if (has('--preflight')) {
    const id = val('--preflight');
    const page = await client.retrievePage(id);
    let photos = [];
    if (mediaBase) {
      const url = L.manifestUrlFor(L.publicIdFor(page.id), mediaBase);
      try { photos = L.manifestToPhotos(await L.fetchManifest(url), url, mediaBase).photos; } catch { /* no photos prepared yet */ }
    }
    console.log(`Preflight for ${id}, public id ${L.publicIdFor(page.id)}\n`);
    printReport(L.readinessReport(page, { photos, mediaBaseUrl: mediaBase, authorisedApproverIds: approverIds(), compliance: compliance() }));
    process.exit(0);
  }

  if (has('--propose')) {
    if (!mediaBase) throw new Error('LISTINGS_MEDIA_BASE_URL is required to propose listings.');
    if (write) {
      // the guard protects the real data directory; tests write to a temporary LISTINGS_DATA_DIR instead
      const branch = process.env.LISTINGS_DATA_DIR ? 'test' : currentBranch();
      if (!branch || ['main', 'master'].includes(branch)) throw new Error(`Refusing to write snapshots on "${branch || 'an unknown branch'}". Create a review branch first: git switch -c listing/<slug>`);
    }
    // 1. verify the data source before trusting any row
    const sch = L.checkDataSourceSchema(await client.retrieveDataSource());
    if (!sch.isValidatedDatabase) throw new Error('The data source does not match the expected CRM schema. Run listings:schema.');
    if (sch.wrongWebType.length) throw new Error(`Web properties with the wrong type: ${sch.wrongWebType.map((w) => w.name).join(', ')}. Run listings:schema.`);
    // 2. read only the properties a proposal needs
    const pages = await client.queryAll({ filterProperties: L.PROPOSAL_PROPERTIES });
    mkdirSync(approvedDir, { recursive: true });
    const actions = await L.propose({
      pages,
      previous: new Map(readJsonDir(approvedDir).map(({ data }) => [data.listingId, data])),
      withdrawn: new Set(readJsonDir(withdrawnDir).map(({ data }) => data.listingId)),
      approvers: approverIds(),
      compliance: compliance(),
      mediaBase,
    });
    let changed = 0;
    let failed = 0;
    for (const a of actions) {
      const bullets = a.issues.length ? `\n  - ${a.issues.join('\n  - ')}` : '';
      if (a.kind === 'failed') { failed += 1; console.error(`NOT PROPOSED  ${a.label}${bullets}`); continue; }
      if (a.kind === 'not_ready') { console.log(`not ready     ${a.label}${bullets}`); continue; }
      if (a.kind === 'withdrawn') { console.log(`withdrawn     ${a.label} (an explicit withdrawal is in place; not proposed)`); continue; }
      if (a.kind === 'unchanged') { console.log(`unchanged     ${a.label}`); continue; }
      changed += 1;
      console.log(`${write ? 'PROPOSED' : 'would propose'}  ${a.label}  [${a.kind}] v${a.snapshot.version}  approver ${a.snapshot.approvedBy}`);
      if (write) writeFileSync(join(approvedDir, `${a.snapshot.content.slug}.json`), `${JSON.stringify(a.snapshot, null, 2)}\n`);
    }
    if (!write) console.log('\nDry run. Nothing written. Re-run with --write on a review branch.');
    else if (changed) console.log('\nWritten. Next: git add src/data/listings/approved, commit, push the branch and open a pull request. The listing is live only when that pull request is reviewed, merged and deployed.');
    process.exit(failed ? 1 : 0);
  }

  console.error('usage: --schema | --preflight <pageId> [--from-file f] | --propose [--write] | --withdraw <id|slug> --reason --by | --reinstate <id>');
  process.exit(2);
} catch (e) {
  // the message never contains the token or any header: NotionApiError carries only status and code
  console.error(`listings-sync failed: ${e.message}`);
  process.exit(1);
}
