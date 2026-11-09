// The real-publication half of the job started by the internal Listings Manager: one branch, one file, one pull request, required checks, merge,
// then proof that the live site serves the listing. Everything here talks to GitHub's REST API (no git binary, no shell) through an injected
// `fetchImpl`, so scripts/test-listings.mjs covers every branch against a fake GitHub and a fake site.
//
// Rules this module enforces:
//   - the ONLY file a publication may change is src/data/listings/approved/<slug>.json (anything else is refused before the commit)
//   - nothing is merged until the required check has passed on the exact commit being merged
//   - a failed or abandoned run closes its pull request and deletes its branch; main is untouched, so the live site is untouched
//   - every step is safe to repeat: a rerun finds the existing branch / pull request / merged file and carries on
import { createHash } from 'node:crypto';

export const SLUG_RE = /^[a-z]+(-[a-z]+)*$/;
export const ARTIFACT_RE = /^src\/data\/listings\/approved\/[a-z]+(-[a-z]+)*\.json$/;
export const CI_WORKFLOW = 'ci.yml';
/** The name of the check run that the branch rules require. It is the job name inside .github/workflows/ci.yml. */
export const REQUIRED_CHECK = 'site-checks';

export const artifactPath = (slug) => {
  if (!SLUG_RE.test(slug ?? '')) throw Object.assign(new Error('the listing slug is not safe to use as a file name'), { code: 'bad_slug' });
  return `src/data/listings/approved/${slug}.json`;
};
export const snapshotText = (snapshot) => `${JSON.stringify(snapshot, null, 2)}\n`;
export const branchFor = (publicId, version, contentHash) => `publish/${publicId}-v${version}-${String(contentHash).replace(/[^a-f0-9]/gi, '').slice(0, 10)}`;

/** Refuses anything but the single approved artifact. `changed` is the list of paths the commit would touch. */
export function assertOnlyArtifact(changed, slug) {
  const want = artifactPath(slug);
  const bad = changed.filter((f) => f !== want || !ARTIFACT_RE.test(f));
  if (bad.length || changed.length !== 1) throw Object.assign(new Error('a publication may change only its own approved listing file'), { code: 'unexpected_files' });
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
export async function openPublicationPr({ gh, snapshot, slug, jobId, mode, defaultBranch = 'main' }) {
  const path = artifactPath(slug);
  const text = snapshotText(snapshot);
  const onMain = await gh.call('GET', `/contents/${path}?ref=${defaultBranch}`, null, { allow: [404] });
  if (onMain.status === 200 && onMain.data?.sha === sha1blob(text)) return { alreadyOnMain: true };

  const branch = branchFor(snapshot.listingId, snapshot.version, snapshot.contentHash);
  const base = (await gh.call('GET', `/git/ref/heads/${defaultBranch}`)).data.object.sha;
  const existing = await gh.call('GET', `/git/ref/heads/${branch}`, null, { allow: [404] });
  if (existing.status === 404) await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base });

  // the file as it is on the branch (it may already carry this commit from an earlier attempt)
  const onBranch = await gh.call('GET', `/contents/${path}?ref=${branch}`, null, { allow: [404] });
  if (!(onBranch.status === 200 && onBranch.data?.sha === sha1blob(text))) {
    const put = await gh.call('PUT', `/contents/${path}`, {
      message: `${mode === 'update' ? 'Update' : 'Publish'} ${slug} (version ${snapshot.version})\n\nApproved in the Listings Manager. Job ${jobId}.`,
      content: enc(text), branch, ...(onBranch.status === 200 ? { sha: onBranch.data.sha } : onMain.status === 200 && existing.status === 404 ? { sha: onMain.data.sha } : {}),
    });
    if (put.data?.commit?.sha === undefined) throw Object.assign(new Error('GitHub did not confirm the commit'), { code: 'commit_failed' });
  }
  // the guard that matters: compare the branch with main and refuse if it touches anything else
  const cmp = (await gh.call('GET', `/compare/${defaultBranch}...${branch}`)).data;
  assertOnlyArtifact((cmp.files ?? []).map((f) => f.filename), slug);
  const headSha = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : (await gh.call('GET', `/git/ref/heads/${branch}`)).data.object.sha;

  const open = (await gh.call('GET', `/pulls?state=open&head=${encodeURIComponent(`${gh.repo}:${branch}`)}`)).data ?? [];
  let pr = open[0];
  if (!pr) {
    pr = (await gh.call('POST', '/pulls', {
      title: `${mode === 'update' ? 'Update' : 'Publish'} ${slug} (version ${snapshot.version})`,
      head: branch, base: defaultBranch,
      body: `Opened by the Listings Manager publication job \`${jobId}\`.\n\nChanges one file only: \`${path}\`.\nThe pull request is merged by the job once the required check \`${REQUIRED_CHECK}\` passes on this exact commit.`,
    })).data;
  }
  return { branch, headSha, prNumber: pr.number, prUrl: pr.html_url };
}

/** Starts the CI workflow on the branch (bot pull requests do not trigger the pull_request event) and waits for the required check. */
export async function waitForChecks({ gh, branch, headSha, sleep = sleepDefault, timeoutMs = 15 * 60 * 1000, pollMs = 10000, now = Date.now }) {
  const existing = await findCheck(gh, headSha);
  if (!existing) await gh.call('POST', `/actions/workflows/${CI_WORKFLOW}/dispatches`, { ref: branch });
  const start = now();
  for (;;) {
    const c = await findCheck(gh, headSha);
    if (c?.status === 'completed') {
      if (c.conclusion === 'success') return { ok: true, url: c.html_url };
      return { ok: false, conclusion: c.conclusion, url: c.html_url };
    }
    if (now() - start > timeoutMs) return { ok: false, conclusion: 'timed_out' };
    await sleep(pollMs);
  }
}
async function findCheck(gh, sha) {
  const runs = (await gh.call('GET', `/commits/${sha}/check-runs?per_page=100`)).data?.check_runs ?? [];
  // the newest run of the required check on this exact commit
  return runs.filter((r) => r.name === REQUIRED_CHECK).sort((a, b) => (a.id < b.id ? 1 : -1))[0] ?? null;
}

/** Squash-merges only the exact commit that passed. A rule refusal (405/409/422) is final and reported, never worked around. */
export async function mergePr({ gh, prNumber, headSha, title }) {
  const r = await gh.call('PUT', `/pulls/${prNumber}/merge`, { merge_method: 'squash', sha: headSha, commit_title: title }, { allow: [405, 409, 422] });
  if (r.status === 200 && r.data?.merged) return { merged: true, sha: r.data.sha };
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
export async function verifyLive({ siteUrl, slug, title, photos, fetchImpl = fetch, sleep = sleepDefault, attempts = 18, pollMs = 10000 }) {
  const base = siteUrl.replace(/\/$/, '');
  let last = [];
  for (let i = 0; i < attempts; i += 1) {
    last = await verifyOnce({ base, slug, title, photos, fetchImpl, bust: `${Date.now()}${i}` });
    if (last.every((c) => c.ok)) return { ok: true, checks: last, url: `${base}/opportunities/${slug}/` };
    if (i < attempts - 1) await sleep(pollMs);
  }
  return { ok: false, checks: last, url: `${base}/opportunities/${slug}/` };
}
async function verifyOnce({ base, slug, title, photos, fetchImpl, bust }) {
  const checks = [];
  const get = async (url, init) => { try { return await fetchImpl(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000), ...init }); } catch { return null; } };
  const page = await get(`${base}/opportunities/${slug}/?v=${bust}`);
  const html = page && page.ok ? await page.text() : '';
  checks.push({ name: 'listing_page', ok: !!page && page.status === 200 && html.length > 0, note: page ? `The listing page answers HTTP ${page.status}.` : 'The listing page could not be reached.' });
  const flat = decode(html);
  checks.push({ name: 'listing_title', ok: html !== '' && flat.includes(title), note: 'The approved title is on the page.' });
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
  return checks;
}
