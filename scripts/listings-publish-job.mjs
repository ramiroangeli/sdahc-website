#!/usr/bin/env node
/*
  Publication job started by the internal Listings Manager (workflow .github/workflows/publish-listing.yml).

    node scripts/listings-publish-job.mjs --job <uuid> --public-id <lst_...> --mode dry_run

  It reuses the EXISTING engine: the same propose() that listings-sync uses, the same safety guards and compliance gates, the same
  test suite, the same build and the same dist privacy scan. It adds only the plumbing around them.

  DRY RUN (the only mode enabled in this release). It proves, without changing anything anywhere, that the approved draft WOULD publish:
    - nothing is written to Notion, nothing is committed or pushed, no pull request is opened, no image is copied to the public store
    - the approved content comes from the app (signed request), the internal fields from the real Notion row (read only token)
    - the proposed snapshot must say exactly what was approved (parity check)
    - the site test suite, a production build with the snapshot, and the privacy scan of the output must pass
  Progress and the result go back to the app over a signed request. This script prints step names only: never listing text, prices or
  internal values, because Actions logs of a public repository are public.

  Environment: LISTINGS_APP_URL, LISTINGS_CALLBACK_SECRET, NOTION_TOKEN, NOTION_PROPERTIES_DATA_SOURCE_ID, LISTINGS_MEDIA_BASE_URL
*/
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';
import { JOB_ID_RE, MODES, PUBLIC_ID_RE, approverFor, checkManifest, overlayPage, parity, signedHeaders, withRetry } from './lib/publish-job.mjs';

const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : undefined; };
const jobId = val('--job'); const publicId = val('--public-id'); const mode = val('--mode');
const appUrl = (process.env.LISTINGS_APP_URL ?? '').replace(/\/$/, ''); const secret = process.env.LISTINGS_CALLBACK_SECRET ?? '';

const log = (m) => console.log(`[publish-job] ${m}`);
if (!JOB_ID_RE.test(jobId ?? '') || !PUBLIC_ID_RE.test(publicId ?? '') || !MODES.includes(mode ?? '')) {
  // a mode that is not enabled is refused before anything runs; the report below needs a valid job id to be accepted
  console.error('[publish-job] invalid arguments (or a mode that is not enabled in this release)');
  if (JOB_ID_RE.test(jobId ?? '') && appUrl && secret) await report('finished', 'failed', { code: 'mode_not_enabled', message: 'This mode is not enabled in this release.' }).catch(() => {});
  process.exit(2);
}
// https only; a loopback address is allowed so the whole job can be rehearsed on a developer machine against a local copy of the app
if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(appUrl) || !secret) { console.error('[publish-job] LISTINGS_APP_URL or LISTINGS_CALLBACK_SECRET is not set'); process.exit(2); }

async function call(method, path, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  // each attempt is signed afresh (the timestamp is part of the signature). A refusal by the app (4xx other than 429) is final and not retried.
  return withRetry(async () => {
    // text/plain on purpose: the host must hand the app the exact bytes that were signed, not a re-serialised JSON object
    const res = await fetch(`${appUrl}${path}`, { method, headers: { ...(bodyObj ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}), ...signedHeaders(secret, method === 'GET' ? `GET:${path}` : body) }, ...(bodyObj ? { body } : {}), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`the app answered HTTP ${res.status}`), { retryable: res.status >= 500 || res.status === 429 });
    return res.json();
  });
}
async function report(step, status, detail) {
  try { await call('POST', '/api/listings/publish-callback', { jobId, step, status, detail: detail ?? null }); } catch (e) { log(`could not report ${step}: ${e.message}`); }
}
const run = (cmd, args, extraEnv = {}) => spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...extraEnv } });
const tail = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-12).join('\n').slice(0, 1500);

async function main() {
  await report('started', 'running');
  log('fetching the approved content from the app');
  const payload = await call('GET', `/api/listings/publish-payload?job=${jobId}`);
  if (payload.publicId !== publicId || payload.mode !== mode || payload.version !== 1) throw Object.assign(new Error('the payload does not match the job'), { code: 'payload_mismatch' });
  await report('payload', 'ok', { photos: payload.manifest.photos.length });

  const mediaBase = process.env.LISTINGS_MEDIA_BASE_URL;
  if (!mediaBase) throw Object.assign(new Error('LISTINGS_MEDIA_BASE_URL is not set'), { code: 'not_configured' });
  const L = await loadTs();
  const cfg = L.readNotionConfig(process.env);
  if (!cfg) throw Object.assign(new Error('Notion read access is not configured'), { code: 'not_configured' });

  const manifestProblems = checkManifest(payload.manifest);
  if (manifestProblems.length) throw Object.assign(new Error(manifestProblems[0]), { code: 'manifest_invalid', problems: manifestProblems });

  log('reading the property row (read only)');
  const client = new L.NotionReadClient(cfg);
  const pages = await client.queryAll({ filterProperties: L.PROPOSAL_PROPERTIES });
  const page = pages.find((p) => L.publicIdFor(p.id) === publicId);
  if (!page) throw Object.assign(new Error('the property was not found in Notion'), { code: 'property_not_found' });
  await report('notion_read', 'ok');

  const dataDir = join(repoRoot, 'src/data/listings');
  const jsonDir = (d) => (existsSync(join(dataDir, d)) ? readdirSync(join(dataDir, d)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dataDir, d, f), 'utf8'))) : []);
  const approvers = JSON.parse(readFileSync(join(dataDir, 'approvers.json'), 'utf8')).approvers;
  // approval comes from the Listings Manager (signed request, Publisher in the app's staff list); the Notion approvers list is the fallback for older payloads
  const approver = approverFor(payload, approvers);
  const authorised = approver ? [approver.id] : approvers.map((x) => x.notionUserId);
  const compliance = JSON.parse(readFileSync(join(dataDir, 'compliance.json'), 'utf8'));

  log('running the existing publication engine on the approved content');
  const overlay = overlayPage(page, payload, approver ? { notionUserId: approver.id, name: approver.name } : null);
  const actions = await L.propose({
    pages: [overlay],
    previous: new Map(jsonDir('approved').map((s) => [s.listingId, s])),
    withdrawn: new Set(jsonDir('withdrawn').map((w) => w.listingId)),
    approvers: authorised,
    compliance,
    mediaBase,
    getManifest: async () => payload.manifest, // the photographs stay private: no public URL is read or written
  });
  const action = actions.find((a) => a.id === publicId);
  const issues = action?.issues ?? [];
  const checks = [
    { name: 'approved_in_listings_manager', ok: Boolean(approver), note: approver ? 'Approved in the Listings Manager by a Publisher (signed request).' : 'No approval accompanied the request.' },
  ];
  if (!action || !action.snapshot) {
    await report('engine', 'failed', { kind: action?.kind ?? 'none', issues, checks });
    throw Object.assign(new Error(`the engine would not publish this listing (${action?.kind ?? 'no result'}, ${issues.length} issue(s))`), { code: 'engine_refused', reported: true });
  }
  checks.push({ name: 'engine_accepts', ok: true, note: `Proposed ${action.kind} v${action.snapshot.version}.` });
  const problems = parity(action.snapshot.content, payload);
  checks.push({ name: 'matches_approved_draft', ok: problems.length === 0, note: problems.length ? `Differs from the approved draft: ${problems.join(', ')}.` : 'The proposed public content is exactly what was approved.' });
  if (problems.length) {
    await report('engine', 'failed', { kind: action.kind, issues: problems.map((p) => `Does not match the approved draft: ${p}`), checks });
    throw Object.assign(new Error('the proposed snapshot differs from the approved draft'), { code: 'parity_failed', reported: true });
  }
  await report('engine', 'ok', { kind: action.kind, version: action.snapshot.version, slug: action.snapshot.content.slug, contentHash: action.snapshot.contentHash, checks });

  log('running the site test suite');
  const tests = run('npm', ['run', 'test:listings']);
  const testsOk = tests.status === 0;
  checks.push({ name: 'site_tests', ok: testsOk, note: testsOk ? 'The listings test suite passes.' : tail(tests) });
  await report('tests', testsOk ? 'ok' : 'failed', testsOk ? null : { checks });
  if (!testsOk) throw Object.assign(new Error('the site test suite failed'), { code: 'tests_failed', reported: true });

  // the snapshot is written only into this runner's workspace (never committed) so the real build can include it
  const slug = action.snapshot.content.slug;
  mkdirSync(join(dataDir, 'approved'), { recursive: true });
  writeFileSync(join(dataDir, 'approved', `${slug}.json`), `${JSON.stringify(action.snapshot, null, 2)}\n`);

  log('building the site with the snapshot');
  const build = run('npm', ['run', 'build'], { LISTINGS_MEDIA_BASE_URL: mediaBase });
  const buildOk = build.status === 0;
  const pagePath = join(repoRoot, '.vercel/output/static/opportunities', slug, 'index.html');
  const pageBuilt = buildOk && existsSync(pagePath);
  let inSitemap = false;
  try { inSitemap = readdirSync(join(repoRoot, '.vercel/output/static')).filter((f) => /^sitemap.*\.xml$/.test(f)).some((f) => readFileSync(join(repoRoot, '.vercel/output/static', f), 'utf8').includes(`/opportunities/${slug}/`)); } catch { /* no sitemap */ }
  checks.push({ name: 'build', ok: pageBuilt, note: pageBuilt ? 'The production build includes the listing page.' : (buildOk ? 'The build finished but has no page for this listing.' : tail(build)) });
  checks.push({ name: 'sitemap', ok: inSitemap, note: inSitemap ? 'The sitemap lists the new page.' : 'The sitemap does not list the new page.' });
  const privacy = run('npm', ['run', 'check:privacy']);
  const privacyOk = privacy.status === 0;
  checks.push({ name: 'privacy_scan', ok: privacyOk, note: privacyOk ? 'The privacy scan of the build output is clean.' : tail(privacy) });
  await report('build', pageBuilt && inSitemap && privacyOk ? 'ok' : 'failed', { checks });
  if (!pageBuilt || !inSitemap || !privacyOk) throw Object.assign(new Error('the build or the privacy scan failed'), { code: 'build_failed', reported: true });

  const result = { dryRun: true, slug, kind: action.kind, version: action.snapshot.version, contentHash: action.snapshot.contentHash, photos: payload.manifest.photos.length, checks, wouldBlock: checks.filter((c) => !c.ok).map((c) => c.name) };
  await report('finished', 'succeeded', result);
  log('dry run finished: nothing was changed');
}

main().catch(async (e) => {
  log(`failed: ${e.code ?? 'error'}`);
  await report('finished', 'failed', { code: e.code ?? 'error', message: String(e.message ?? e).slice(0, 300), ...(e.problems ? { problems: e.problems } : {}) });
  process.exit(1);
});
