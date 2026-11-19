// The real-publication half of the job started by the internal Listings Manager: one branch, one file, one pull request, required checks, merge,
// then proof that the live site serves the listing. Everything here talks to GitHub's REST API (no git binary, no shell) through an injected
// `fetchImpl`, so scripts/test-listings.mjs covers every branch against a fake GitHub and a fake site.
//
// Rules this module enforces:
//   - the ONLY file a publication may change is src/data/listings/approved/<slug>.json (anything else is refused before the commit)
//   - the ONLY file a withdrawal may change is src/data/listings/withdrawn/<id>.json, and it carries no reason and no person (the site is public)
//   - nothing is merged until the required check has passed on the exact commit being merged
//   - a failed or abandoned run closes its pull request and deletes its branch; main is untouched, so the live site is untouched
//   - every step is safe to repeat: a rerun finds the existing branch / pull request / merged file and carries on
import { createHash } from 'node:crypto';

export const SLUG_RE = /^[a-z]+(-[a-z]+)*$/;
export const ARTIFACT_RE = /^src\/data\/listings\/approved\/[a-z]+(-[a-z]+)*\.json$/;
/** The name of the check run that the branch rules require. It is the job name inside .github/workflows/ci.yml. */
export const REQUIRED_CHECK = 'site-checks';

export const artifactPath = (slug) => {
  if (!SLUG_RE.test(slug ?? '')) throw Object.assign(new Error('the listing slug is not safe to use as a file name'), { code: 'bad_slug' });
  return `src/data/listings/approved/${slug}.json`;
};
export const snapshotText = (snapshot) => `${JSON.stringify(snapshot, null, 2)}\n`;
export const branchFor = (publicId, version, contentHash, tag = '') => `publish/${publicId}-v${version}-${String(contentHash).replace(/[^a-f0-9]/gi, '').slice(0, 10)}${tag ? `-${String(tag).replace(/[^a-f0-9]/gi, '').slice(0, 8)}` : ''}`;
const STATUS_WORDS = { available: 'available', under_offer: 'under offer', sold: 'sold' };

/**
 * Refuses anything but the single approved artifact. `changed` is the list of paths the commit would touch. A publication that RESTORES a withdrawn listing
 * (`restoreId`) may also remove that listing's withdrawal marker and take its id out of the saved display order: nothing else.
 */
export function assertOnlyArtifact(changed, slug, restoreId = null) {
  const want = artifactPath(slug);
  if (!restoreId) {
    const bad = changed.filter((f) => f !== want || !ARTIFACT_RE.test(f));
    if (bad.length || changed.length !== 1) throw Object.assign(new Error('a publication may change only its own approved listing file'), { code: 'unexpected_files' });
    return;
  }
  const allowed = new Set([want, withdrawnPath(restoreId), ORDER_PATH]);
  if (changed.length === 0 || changed.some((f) => !allowed.has(f))) throw Object.assign(new Error('a restoring publication may change only its own listing file, its withdrawal marker and its place in the display order'), { code: 'unexpected_files' });
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (s) => Buffer.from(s, 'utf8').toString('base64');
const sha1blob = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');

/** A small GitHub client. Errors carry the HTTP status only, never a body that might echo something sensitive. */
export function githubClient({ token, repo, fetchImpl = fetch, api = 'https://api.github.com' }) {
  async function call(method, path, body, { allow = [] } = {}) {
    const res = await fetchImpl(`${api}/repos/${repo}${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sdahc-listings-publish', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 204) return { status: 204, data: null };
    let data = null; try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok && !allow.includes(res.status)) throw Object.assign(new Error(`GitHub answered HTTP ${res.status} for ${method} ${path.split('?')[0].replace(/\/[0-9a-f]{7,40}\b/g, '/…')}`), { code: 'github_error', status: res.status, retryable: res.status >= 500 || res.status === 429 });
    return { status: res.status, data };
  }
  return { call, repo };
}

/**
 * Opens (or finds) the publication pull request for this exact content and returns where it stands.
 *   { alreadyOnMain: true }                      main already holds exactly this file: nothing to open (an idempotent rerun)
 *   { branch, headSha, prNumber, prUrl }         ready for checks
 */
export async function openPublicationPr({ gh, snapshot, slug, jobId, mode, restore = null, defaultBranch = 'main' }) {
  const path = artifactPath(slug);
  const text = snapshotText(snapshot);
  const onMain = await gh.call('GET', `/contents/${path}?ref=${defaultBranch}`, null, { allow: [404] });
  // RESTORE: the same publication goes back on the website. Its withdrawal marker is removed in the same pull request, and its id is taken out of the saved
  // display order (so it does not come back to an old place: it joins the order by the usual rule for a listing with no saved place).
  const lift = restore ? await liftState(gh, restore.listingId, defaultBranch) : null;
  const lifting = !!lift && (lift.tombSha !== null || lift.orderHasId);
  if (onMain.status === 200 && onMain.data?.sha === sha1blob(text) && !lifting) return { alreadyOnMain: true };

  // a status-only change keeps the version and the content hash, so its branch needs its own name
  let mainVersion = null;
  try { mainVersion = onMain.status === 200 ? JSON.parse(Buffer.from(onMain.data.content ?? '', 'base64').toString('utf8')).version : null; } catch { mainVersion = null; }
  const statusOnly = mainVersion !== null && mainVersion === snapshot.version;
  const what = statusOnly ? `${slug} (status: ${STATUS_WORDS[snapshot.commercialStatus] ?? 'changed'})` : `${slug} (version ${snapshot.version})`;
  const branch = branchFor(snapshot.listingId, snapshot.version, snapshot.contentHash, lifting ? sha1blob(`restore:${text}`) : statusOnly ? sha1blob(text) : '');
  const base = (await gh.call('GET', `/git/ref/heads/${defaultBranch}`)).data.object.sha;
  const existing = await gh.call('GET', `/git/ref/heads/${branch}`, null, { allow: [404] });
  if (existing.status === 404) await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base });

  const verb = lifting ? 'Restore' : mode === 'update' ? 'Update' : 'Publish';
  // the file as it is on the branch (it may already carry this commit from an earlier attempt)
  const onBranch = await gh.call('GET', `/contents/${path}?ref=${branch}`, null, { allow: [404] });
  if (!(onBranch.status === 200 && onBranch.data?.sha === sha1blob(text))) {
    const put = await gh.call('PUT', `/contents/${path}`, {
      message: `${verb} ${what}\n\nApproved in the Listings Manager. Job ${jobId}.`,
      content: enc(text), branch, ...(onBranch.status === 200 ? { sha: onBranch.data.sha } : onMain.status === 200 && existing.status === 404 ? { sha: onMain.data.sha } : {}),
    });
    if (put.data?.commit?.sha === undefined) throw Object.assign(new Error('GitHub did not confirm the commit'), { code: 'commit_failed' });
  }
  if (lifting) {
    const tombPath = withdrawnPath(restore.listingId);
    const tb = await gh.call('GET', `/contents/${tombPath}?ref=${branch}`, null, { allow: [404] });
    if (tb.status === 200) await gh.call('DELETE', `/contents/${tombPath}`, { message: `Lift the withdrawal of ${slug}\n\nJob ${jobId}.`, sha: tb.data.sha, branch });
    if (lift.orderHasId) {
      const ob = await gh.call('GET', `/contents/${ORDER_PATH}?ref=${branch}`, null, { allow: [404] });
      if (ob.status === 200) {
        let ids = []; try { ids = JSON.parse(Buffer.from(ob.data.content ?? '', 'base64').toString('utf8')).order ?? []; } catch { ids = []; }
        const next = orderText(ids.filter((x) => x !== restore.listingId));
        if (ob.data.sha !== sha1blob(next)) await gh.call('PUT', `/contents/${ORDER_PATH}`, { message: `Take ${slug} out of the saved display order\n\nJob ${jobId}.`, content: enc(next), branch, sha: ob.data.sha });
      }
    }
  }
  // the guard that matters: compare the branch with main and refuse if it touches anything else
  const cmp = (await gh.call('GET', `/compare/${defaultBranch}...${branch}`)).data;
  assertOnlyArtifact((cmp.files ?? []).map((f) => f.filename), slug, lifting ? restore.listingId : null);
  const headSha = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : (await gh.call('GET', `/git/ref/heads/${branch}`)).data.object.sha;

  const open = (await gh.call('GET', `/pulls?state=open&head=${encodeURIComponent(`${gh.repo}:${branch}`)}`)).data ?? [];
  let pr = open[0];
  if (!pr) {
    pr = (await gh.call('POST', '/pulls', {
      title: `${verb} ${what}`,
      head: branch, base: defaultBranch,
      body: lifting
        ? `Opened by the Listings Manager publication job \`${jobId}\`.\n\nRestores a withdrawn listing: changes its approved file \`${path}\`, removes its withdrawal marker and, if present, its id from the saved display order. Nothing else.\nThe pull request is merged by the job once the required check \`${REQUIRED_CHECK}\` passes on this exact commit.`
        : `Opened by the Listings Manager publication job \`${jobId}\`.\n\nChanges one file only: \`${path}\`.\nThe pull request is merged by the job once the required check \`${REQUIRED_CHECK}\` passes on this exact commit.`,
    })).data;
  }
  return { branch, headSha, prNumber: pr.number, prUrl: pr.html_url, title: pr.title ?? `${verb} ${what}` };
}
/** Is the withdrawal marker still on main, and is the listing still in the saved display order? */
async function liftState(gh, listingId, defaultBranch) {
  const tomb = await gh.call('GET', `/contents/${withdrawnPath(listingId)}?ref=${defaultBranch}`, null, { allow: [404] });
  const ord = await gh.call('GET', `/contents/${ORDER_PATH}?ref=${defaultBranch}`, null, { allow: [404] });
  let ids = []; try { ids = ord.status === 200 ? JSON.parse(Buffer.from(ord.data.content ?? '', 'base64').toString('utf8')).order ?? [] : []; } catch { ids = []; }
  return { tombSha: tomb.status === 200 ? tomb.data.sha : null, orderHasId: ids.includes(listingId) };
}

/**
 * Waits for the required check on the pull request's head commit. The pull request is opened with the GitHub App token, which starts the
 * normal pull_request run of ci.yml by itself, so nothing is dispatched here: a manually started run would NOT satisfy the branch rules.
 * If no run appears within `startMs` the check did not start and the job stops (it is never started by hand).
 */
export async function waitForChecks({ gh, headSha, sleep = sleepDefault, timeoutMs = 15 * 60 * 1000, startMs = 3 * 60 * 1000, pollMs = 10000, now = Date.now }) {
  const start = now();
  for (;;) {
    const c = await findCheck(gh, headSha);
    if (c?.status === 'completed') {
      if (c.conclusion === 'success') return { ok: true, url: c.html_url };
      return { ok: false, conclusion: c.conclusion, url: c.html_url };
    }
    if (!c && now() - start > startMs) return { ok: false, conclusion: 'not_started' };
    if (now() - start > timeoutMs) return { ok: false, conclusion: 'timed_out' };
    await sleep(pollMs);
  }
}
async function findCheck(gh, sha) {
  const runs = (await gh.call('GET', `/commits/${sha}/check-runs?per_page=100`)).data?.check_runs ?? [];
  // the newest run of the required check on this exact commit
  return runs.filter((r) => r.name === REQUIRED_CHECK).sort((a, b) => (a.id < b.id ? 1 : -1))[0] ?? null;
}

/**
 * Squash-merges only the exact commit that passed. A rule refusal is final and reported, never worked around. The only patience allowed: a 405
 * is tried again a few times, because GitHub can take a few seconds to register a check that has just finished (the rules are not bypassed:
 * if the check really is missing or failed, every attempt is refused).
 */
export async function mergePr({ gh, prNumber, headSha, title, sleep = sleepDefault, attempts = 4, pollMs = 5000 }) {
  let r;
  for (let i = 0; i < attempts; i += 1) {
    r = await gh.call('PUT', `/pulls/${prNumber}/merge`, { merge_method: 'squash', sha: headSha, commit_title: title }, { allow: [405, 409, 422] });
    if (r.status === 200 && r.data?.merged) return { merged: true, sha: r.data.sha };
    if (r.status !== 405 || i === attempts - 1) break;
    await sleep(pollMs);
  }
  throw Object.assign(new Error(`the branch rules did not allow the merge (HTTP ${r.status})`), { code: 'merge_refused', status: r.status });
}

/** Failure clean-up: close the pull request and delete its branch. Never touches main. Best effort. */
export async function abandon({ gh, prNumber, branch }) {
  try { if (prNumber) await gh.call('PATCH', `/pulls/${prNumber}`, { state: 'closed' }, { allow: [404, 422] }); } catch { /* best effort */ }
  try { if (branch) await gh.call('DELETE', `/git/refs/heads/${branch}`, null, { allow: [404, 422] }); } catch { /* best effort */ }
}

/** The commit that is on main right now for this file (used when a rerun finds the file already merged). */
export async function mainHead(gh, defaultBranch = 'main') {
  return (await gh.call('GET', `/git/ref/heads/${defaultBranch}`)).data.object.sha;
}

/** Waits for the Vercel Production deployment of this commit when GitHub records one. Returns null if none is recorded in time (the site check then decides). */
export async function waitForDeployment({ gh, sha, sleep = sleepDefault, timeoutMs = 10 * 60 * 1000, pollMs = 10000, discoverMs = 3 * 60 * 1000, now = Date.now }) {
  const start = now();
  for (;;) {
    const list = (await gh.call('GET', `/deployments?sha=${sha}&per_page=20`)).data ?? [];
    const dep = list.find((d) => /production/i.test(d.environment ?? ''));
    if (dep) {
      const st = (await gh.call('GET', `/deployments/${dep.id}/statuses?per_page=5`)).data ?? [];
      const latest = st[0];
      if (latest?.state === 'success') return { state: 'success', url: latest.environment_url ?? latest.target_url ?? null };
      if (latest && ['failure', 'error'].includes(latest.state)) return { state: latest.state, url: latest.target_url ?? null };
    } else if (now() - start > discoverMs) return null;
    if (now() - start > timeoutMs) return { state: 'timed_out' };
    await sleep(pollMs);
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Proves the listing is really live on the production site: the page answers, shows the approved title, carries every approved photograph in
 * the approved order, every image answers as WebP, and the catalogue links to the page. Retries while the new deployment propagates.
 * Returns { ok, checks:[{name, ok, note}] }. Notes never contain listing text.
 */
export async function verifyLive({ siteUrl, slug, title, photos, status, checkSitemap = false, fetchImpl = fetch, sleep = sleepDefault, attempts = 18, pollMs = 10000 }) {
  const base = siteUrl.replace(/\/$/, '');
  let last = [];
  for (let i = 0; i < attempts; i += 1) {
    last = await verifyOnce({ base, slug, title, photos, status, checkSitemap, fetchImpl, bust: `${Date.now()}${i}` });
    if (last.every((c) => c.ok)) return { ok: true, checks: last, url: `${base}/opportunities/${slug}/` };
    if (i < attempts - 1) await sleep(pollMs);
  }
  return { ok: false, checks: last, url: `${base}/opportunities/${slug}/` };
}
async function verifyOnce({ base, slug, title, photos, status, checkSitemap, fetchImpl, bust }) {
  const checks = [];
  const get = async (url, init) => { try { return await fetchImpl(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000), ...init }); } catch { return null; } };
  const page = await get(`${base}/opportunities/${slug}/?v=${bust}`);
  const html = page && page.ok ? await page.text() : '';
  checks.push({ name: 'listing_page', ok: !!page && page.status === 200 && html.length > 0, note: page ? `The listing page answers HTTP ${page.status}.` : 'The listing page could not be reached.' });
  const flat = decode(html);
  checks.push({ name: 'listing_title', ok: html !== '' && flat.includes(title), note: 'The approved title is on the page.' });
  if (status) {
    checks.push({ name: 'listing_status', ok: html !== '' && html.includes(`lsb-${status}`), note: `The page shows the ${STATUS_WORDS[status] ?? status} status.` });
    // a sold property must not be offered for purchase: no purchase enquiry on its page
    if (status === 'sold') checks.push({ name: 'sold_page', ok: html !== '' && !flat.includes('Enquire about this property') && !html.includes('data-le-form'), note: 'The page does not offer the sold property for enquiry.' });
  }
  const order = photos.map((p) => flat.indexOf(`${p.id}`));
  const inOrder = order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1]));
  checks.push({ name: 'gallery', ok: html !== '' && inOrder, note: inOrder ? `All ${photos.length} photographs are on the page in the approved order.` : 'Not every approved photograph is on the page in the approved order yet.' });
  let imagesOk = html !== '';
  let okCount = 0;
  for (const p of photos) {
    const src = p.src;
    const r = src ? await get(src, { method: 'GET' }) : null;
    const good = !!r && r.status === 200 && /image\/webp/i.test(r.headers.get('content-type') ?? '');
    if (good) okCount += 1; else imagesOk = false;
    if (r && r.body) { try { await r.body.cancel(); } catch { /* ignore */ } }
  }
  checks.push({ name: 'images', ok: imagesOk && okCount === photos.length, note: `${okCount} of ${photos.length} images answer as WebP from the public store.` });
  const cat = await get(`${base}/opportunities/?v=${bust}`);
  const catHtml = cat && cat.ok ? await cat.text() : '';
  checks.push({ name: 'catalogue', ok: catHtml.includes(`/opportunities/${slug}/`), note: 'The catalogue links to the listing.' });
  if (checkSitemap) {
    // a restored listing must be back in the sitemap, not only on its page
    const idx = await get(`${base}/sitemap-index.xml?v=${bust}`);
    const idxText = idx && idx.ok ? await idx.text() : '';
    const maps = [...idxText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(base));
    let read = 0; let listed = false;
    for (const u of maps.length ? maps : [`${base}/sitemap-0.xml`]) { const r = await get(`${u}?v=${bust}`); if (r && r.ok) { read += 1; if ((await r.text()).includes(`/opportunities/${slug}/`)) listed = true; } }
    checks.push({ name: 'sitemap', ok: read > 0 && listed, note: read === 0 ? 'The sitemap could not be read.' : listed ? 'The sitemap lists the listing again.' : 'The sitemap does not list the listing yet.' });
  }
  return checks;
}

/* ---------------------------------------------------------------- withdrawal (remove a listing from public marketing) */
export const WITHDRAWN_RE = /^src\/data\/listings\/withdrawn\/lst_[a-f0-9]{10}\.json$/;
export const withdrawnPath = (listingId) => {
  if (!/^lst_[a-f0-9]{10}$/.test(listingId ?? '')) throw Object.assign(new Error('the listing id is not safe to use as a file name'), { code: 'bad_id' });
  return `src/data/listings/withdrawn/${listingId}.json`;
};
/**
 * The public tombstone. Constant words only: this file, its pull request, its commit and the Actions log are all public, so the reason for a
 * withdrawal and the person who asked never appear here (they live only in the Listings Manager's private audit trail).
 */
export const tombstoneFor = (listingId, at) => ({ listingId, withdrawnAt: at, withdrawnBy: 'SDA Home Choices', reason: 'withdrawn' });
export const tombstoneText = (t) => `${JSON.stringify(t, null, 2)}\n`;
export function assertOnlyTombstone(changed, listingId) {
  const want = withdrawnPath(listingId);
  if (changed.length !== 1 || changed[0] !== want || !WITHDRAWN_RE.test(changed[0])) throw Object.assign(new Error('a withdrawal may change only its own withdrawal file'), { code: 'unexpected_files' });
}

/**
 * Opens (or finds) the withdrawal pull request. { alreadyOnMain: true } when main already holds a withdrawal for this listing (a rerun after the merge,
 * or a withdrawal made another way): nothing to open. Otherwise { branch, headSha, prNumber, prUrl, title } ready for checks.
 */
export async function openWithdrawalPr({ gh, listingId, slug, at, jobId, defaultBranch = 'main' }) {
  const path = withdrawnPath(listingId);
  if (!SLUG_RE.test(slug ?? '')) throw Object.assign(new Error('the listing slug is not safe to use in a title'), { code: 'bad_slug' });
  const text = tombstoneText(tombstoneFor(listingId, at));
  const onMain = await gh.call('GET', `/contents/${path}?ref=${defaultBranch}`, null, { allow: [404] });
  if (onMain.status === 200) return { alreadyOnMain: true };

  const branch = `withdraw/${listingId}`;
  const base = (await gh.call('GET', `/git/ref/heads/${defaultBranch}`)).data.object.sha;
  const existing = await gh.call('GET', `/git/ref/heads/${branch}`, null, { allow: [404] });
  if (existing.status === 404) await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base });
  const onBranch = await gh.call('GET', `/contents/${path}?ref=${branch}`, null, { allow: [404] });
  if (!(onBranch.status === 200 && onBranch.data?.sha === sha1blob(text))) {
    const put = await gh.call('PUT', `/contents/${path}`, {
      message: `Withdraw ${slug} from public marketing\n\nApproved in the Listings Manager. Job ${jobId}.`,
      content: enc(text), branch, ...(onBranch.status === 200 ? { sha: onBranch.data.sha } : {}),
    });
    if (put.data?.commit?.sha === undefined) throw Object.assign(new Error('GitHub did not confirm the commit'), { code: 'commit_failed' });
  }
  const cmp = (await gh.call('GET', `/compare/${defaultBranch}...${branch}`)).data;
  assertOnlyTombstone((cmp.files ?? []).map((f) => f.filename), listingId);
  const headSha = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : (await gh.call('GET', `/git/ref/heads/${branch}`)).data.object.sha;
  const open = (await gh.call('GET', `/pulls?state=open&head=${encodeURIComponent(`${gh.repo}:${branch}`)}`)).data ?? [];
  let pr = open[0];
  const title = `Withdraw ${slug} from public marketing`;
  if (!pr) {
    pr = (await gh.call('POST', '/pulls', {
      title, head: branch, base: defaultBranch,
      body: `Opened by the Listings Manager publication job \`${jobId}\`.\n\nChanges one file only: \`${path}\`.\nThe pull request is merged by the job once the required check \`${REQUIRED_CHECK}\` passes on this exact commit.`,
    })).data;
  }
  return { branch, headSha, prNumber: pr.number, prUrl: pr.html_url, title };
}

/**
 * Proof that the listing is really gone from the live site: its page answers 404, the catalogue does not link to it and no sitemap lists it.
 * Retries while the new deployment propagates.
 */
export async function verifyWithdrawn({ siteUrl, slug, fetchImpl = fetch, sleep = sleepDefault, attempts = 18, pollMs = 10000 }) {
  const base = siteUrl.replace(/\/$/, '');
  const needle = `/opportunities/${slug}`;
  let last = [];
  for (let i = 0; i < attempts; i += 1) {
    const get = async (url) => { try { return await fetchImpl(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) }); } catch { return null; } };
    const bust = `${Date.now()}${i}`;
    const checks = [];
    const page = await get(`${base}/opportunities/${slug}/?v=${bust}`);
    checks.push({ name: 'page_gone', ok: !!page && (page.status === 404 || page.status === 410), note: page ? `The listing page answers HTTP ${page.status}.` : 'The listing page could not be reached.' });
    const cat = await get(`${base}/opportunities/?v=${bust}`);
    const catHtml = cat && cat.ok ? await cat.text() : null;
    checks.push({ name: 'catalogue_clear', ok: catHtml !== null && !catHtml.includes(needle), note: catHtml === null ? 'The catalogue could not be read.' : 'The catalogue no longer links to the listing.' });
    let sitemapOk = false; let listed = false; let read = 0;
    const idx = await get(`${base}/sitemap-index.xml?v=${bust}`);
    const idxText = idx && idx.ok ? await idx.text() : '';
    const maps = [...idxText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(base));
    for (const u of maps.length ? maps : [`${base}/sitemap-0.xml`]) {
      const r = await get(`${u}?v=${bust}`);
      if (r && r.ok) { read += 1; if ((await r.text()).includes(needle)) listed = true; }
    }
    sitemapOk = read > 0 && !listed;
    checks.push({ name: 'sitemap_clear', ok: sitemapOk, note: read === 0 ? 'The sitemap could not be read.' : listed ? 'The sitemap still lists the listing.' : 'The sitemap no longer lists the listing.' });
    last = checks;
    if (checks.every((c) => c.ok)) return { ok: true, checks, url: `${base}/opportunities/${slug}/` };
    if (i < attempts - 1) await sleep(pollMs);
  }
  return { ok: false, checks: last, url: `${base}/opportunities/${slug}/` };
}

/* ---------------------------------------------------------------- display order (the default order of the public catalogue) */
export const ORDER_PATH = 'src/data/listings/display-order.json';
export const ORDER_ID_RE = /^lst_[a-f0-9]{10}$/;
/** The order file holds listing ids only: no content, no person. It is public like everything else in this repository. */
export const orderText = (ids) => `${JSON.stringify({ version: 1, order: ids }, null, 2)}\n`;
/** The ids of a requested order, or the reason it is refused (at most 500, each a public listing id, none twice). */
export function checkOrder(ids) {
  if (!Array.isArray(ids) || ids.length > 500) return ['the order must be a list of at most 500 listing ids'];
  const bad = ids.filter((x) => typeof x !== 'string' || !ORDER_ID_RE.test(x));
  if (bad.length) return ['the order contains something that is not a listing id'];
  if (new Set(ids).size !== ids.length) return ['a listing appears twice in the order'];
  return [];
}
export function assertOnlyOrder(changed) {
  if (changed.length !== 1 || changed[0] !== ORDER_PATH) throw Object.assign(new Error('a display order change may change only the display order file'), { code: 'unexpected_files' });
}

/**
 * Opens (or finds) the display order pull request. { alreadyOnMain: true } when main already holds exactly this order (a rerun after the merge).
 * Otherwise { branch, headSha, prNumber, prUrl, title } ready for checks. The only file it may change is display-order.json.
 */
export async function openOrderPr({ gh, ids, jobId, defaultBranch = 'main' }) {
  const problems = checkOrder(ids);
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: 'bad_order' });
  const text = orderText(ids);
  const onMain = await gh.call('GET', `/contents/${ORDER_PATH}?ref=${defaultBranch}`, null, { allow: [404] });
  if (onMain.status === 200 && onMain.data?.sha === sha1blob(text)) return { alreadyOnMain: true };

  const branch = `order/${sha1blob(text).slice(0, 10)}`;
  const base = (await gh.call('GET', `/git/ref/heads/${defaultBranch}`)).data.object.sha;
  const existing = await gh.call('GET', `/git/ref/heads/${branch}`, null, { allow: [404] });
  if (existing.status === 404) await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base });
  const onBranch = await gh.call('GET', `/contents/${ORDER_PATH}?ref=${branch}`, null, { allow: [404] });
  if (!(onBranch.status === 200 && onBranch.data?.sha === sha1blob(text))) {
    const put = await gh.call('PUT', `/contents/${ORDER_PATH}`, {
      message: `Set the website display order\n\nApproved in the Listings Manager. Job ${jobId}.`,
      content: enc(text), branch, ...(onBranch.status === 200 ? { sha: onBranch.data.sha } : onMain.status === 200 && existing.status === 404 ? { sha: onMain.data.sha } : {}),
    });
    if (put.data?.commit?.sha === undefined) throw Object.assign(new Error('GitHub did not confirm the commit'), { code: 'commit_failed' });
  }
  const cmp = (await gh.call('GET', `/compare/${defaultBranch}...${branch}`)).data;
  assertOnlyOrder((cmp.files ?? []).map((f) => f.filename));
  const headSha = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : (await gh.call('GET', `/git/ref/heads/${branch}`)).data.object.sha;
  const open = (await gh.call('GET', `/pulls?state=open&head=${encodeURIComponent(`${gh.repo}:${branch}`)}`)).data ?? [];
  let pr = open[0];
  const title = 'Set the website display order';
  if (!pr) {
    pr = (await gh.call('POST', '/pulls', {
      title, head: branch, base: defaultBranch,
      body: `Opened by the Listings Manager publication job \`${jobId}\`.\n\nChanges one file only: \`${ORDER_PATH}\` (listing ids, no content).\nThe pull request is merged by the job once the required check \`${REQUIRED_CHECK}\` passes on this exact commit.`,
    })).data;
  }
  return { branch, headSha, prNumber: pr.number, prUrl: pr.html_url, title };
}

/** The listing slugs in the order a catalogue page shows them (first appearance of each listing link; off-market is not a listing). */
export const slugsInCatalogue = (html) => {
  const seen = [];
  for (const m of String(html).matchAll(/href="\/opportunities\/([a-z]+(?:-[a-z]+)*)\/"/g)) if (m[1] !== 'off-market' && !seen.includes(m[1])) seen.push(m[1]);
  return seen;
};

/**
 * Proof that the live catalogue shows the listings in the order the build produced. Retries while the new deployment propagates.
 * Returns { ok, checks:[{name, ok, note}] }. Notes never contain listing text.
 */
export async function verifyOrderLive({ siteUrl, expected, fetchImpl = fetch, sleep = sleepDefault, attempts = 18, pollMs = 10000 }) {
  const base = siteUrl.replace(/\/$/, '');
  let last = [];
  for (let i = 0; i < attempts; i += 1) {
    let html = null;
    try { const r = await fetchImpl(`${base}/opportunities/?v=${Date.now()}${i}`, { redirect: 'follow', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) }); html = r.ok ? await r.text() : null; } catch { html = null; }
    const got = html === null ? null : slugsInCatalogue(html);
    last = [{ name: 'catalogue_order', ok: got !== null && JSON.stringify(got) === JSON.stringify(expected), note: got === null ? 'The catalogue could not be read.' : JSON.stringify(got) === JSON.stringify(expected) ? `The live catalogue lists all ${expected.length} properties in the new order.` : 'The live catalogue does not show the new order yet.' }];
    if (last.every((c) => c.ok)) return { ok: true, checks: last, url: `${base}/opportunities/` };
    if (i < attempts - 1) await sleep(pollMs);
  }
  return { ok: false, checks: last, url: `${base}/opportunities/` };
}
