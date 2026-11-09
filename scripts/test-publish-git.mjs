// Tests for scripts/lib/publish-git.mjs against a fake GitHub (in memory) and a fake production site. No network, no git, no secrets.
// Called from scripts/test-listings.mjs with its t() and section() helpers.
import { createHash } from 'node:crypto';
import { REQUIRED_CHECK, abandon, artifactPath, assertOnlyArtifact, branchFor, githubClient, mergePr, openPublicationPr, snapshotText, verifyLive, waitForChecks, waitForDeployment } from './lib/publish-git.mjs';

const sha1 = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const rid = (() => { let n = 1000; return () => (n += 1); })();
const commitSha = () => rid().toString(16).padStart(40, 'a');

function fakeGitHub(opts = {}) {
  const s = { refs: { main: 'm'.repeat(40) }, files: { main: { 'package.json': '{}\n' } }, prs: [], checkRuns: {}, dispatches: [], merged: [], deployments: [], statuses: {}, calls: [], ...opts.state };
  const json = (status, data) => ({ ok: status < 400, status, headers: new Headers(), json: async () => data });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''); const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    s.calls.push(`${method} ${path}`);
    if (!/^Bearer tok/.test(init.headers?.Authorization ?? '')) return json(401, { message: 'bad credentials' });
    let m;
    if (method === 'GET' && (m = path.match(/^\/contents\/(.+)$/))) { const f = s.files[u.searchParams.get('ref')]?.[decodeURIComponent(m[1])]; return f === undefined ? json(404, {}) : json(200, { sha: sha1(f) }); }
    if (method === 'GET' && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) return s.refs[m[1]] ? json(200, { object: { sha: s.refs[m[1]] } }) : json(404, {});
    if (method === 'POST' && path === '/git/refs') { const b = body.ref.replace('refs/heads/', ''); s.refs[b] = body.sha; s.files[b] = { ...s.files.main }; return json(201, {}); }
    if (method === 'PUT' && (m = path.match(/^\/contents\/(.+)$/))) {
      const b = body.branch; s.files[b][decodeURIComponent(m[1])] = Buffer.from(body.content, 'base64').toString('utf8'); const c = commitSha(); s.refs[b] = c; s.lastCommit = body;
      if (opts.alsoTouch) s.files[b][opts.alsoTouch] = 'changed';
      return json(200, { commit: { sha: c } });
    }
    if (method === 'GET' && (m = path.match(/^\/compare\/main\.\.\.(.+)$/))) {
      const b = m[1]; const changed = Object.keys(s.files[b]).filter((k) => s.files[b][k] !== s.files.main[k]);
      return json(200, { files: changed.map((filename) => ({ filename })), commits: changed.length ? [{ sha: s.refs[b] }] : [] });
    }
    if (method === 'GET' && path === '/pulls') return json(200, s.prs.filter((p) => p.state === 'open' && u.searchParams.get('head').endsWith(`:${p.head}`)));
    if (method === 'POST' && path === '/pulls') { const p = { number: s.prs.length + 7, state: 'open', head: body.head, html_url: `https://github.example/pull/${s.prs.length + 7}`, title: body.title, body: body.body }; s.prs.push(p); return json(201, p); }
    if (method === 'PATCH' && (m = path.match(/^\/pulls\/(\d+)$/))) { const p = s.prs.find((x) => x.number === Number(m[1])); p.state = body.state; return json(200, p); }
    if (method === 'DELETE' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) { delete s.refs[m[1]]; delete s.files[m[1]]; return json(204, {}); }
    if (method === 'POST' && path === '/actions/workflows/ci.yml/dispatches') {
      s.dispatches.push(body.ref);
      s.checkRuns[s.refs[body.ref]] = [{ id: rid(), name: REQUIRED_CHECK, status: opts.checkPending ? 'in_progress' : 'completed', conclusion: opts.checkPending ? null : (opts.checkConclusion ?? 'success'), html_url: 'https://github.example/run/1' }];
      return { ok: true, status: 204, headers: new Headers(), json: async () => { throw new Error('no body'); } };
    }
    if (method === 'GET' && (m = path.match(/^\/commits\/([0-9a-f]+)\/check-runs$/))) return json(200, { check_runs: s.checkRuns[m[1]] ?? [] });
    if (method === 'PUT' && (m = path.match(/^\/pulls\/(\d+)\/merge$/))) {
      const p = s.prs.find((x) => x.number === Number(m[1]));
      const ok = (s.checkRuns[s.refs[p.head]] ?? []).some((r) => r.name === REQUIRED_CHECK && r.conclusion === 'success');
      if (body.sha !== s.refs[p.head]) return json(409, { message: 'head changed' });
      if (!ok || opts.refuseMerge) return json(405, { message: 'Required status check is expected.' });
      Object.assign(s.files.main, s.files[p.head]); s.refs.main = commitSha(); p.state = 'closed'; s.merged.push(p.number);
      return json(200, { merged: true, sha: s.refs.main });
    }
    if (method === 'GET' && path === '/deployments') return json(200, s.deployments);
    if (method === 'GET' && (m = path.match(/^\/deployments\/(\d+)\/statuses$/))) return json(200, s.statuses[m[1]] ?? []);
    return json(404, { message: `unhandled ${method} ${path}` });
  };
  return { s, gh: githubClient({ token: 'tok_secret_value', repo: 'o/r', fetchImpl, api: 'https://api.github.test' }) };
}

const SLUG = 'example-street-testville-vic';
const snap = (over = {}) => ({ listingId: 'lst_0123456789', version: 1, contentHash: 'abcdef0123456789abcdef', content: { slug: SLUG, title: 'A test listing' }, ...over });
const noSleep = async () => {};

export default async function run({ t, section }) {
  section('real publication: one-file pull request, required check, merge (fake GitHub)');
  t('only the approved listing file may be changed: anything else, or a second file, is refused', (() => {
    const bad = (c) => { try { assertOnlyArtifact(c, SLUG); return false; } catch (e) { return e.code === 'unexpected_files'; } };
    assertOnlyArtifact([artifactPath(SLUG)], SLUG);
    return bad([]) && bad(['package.json']) && bad([artifactPath(SLUG), '.github/workflows/ci.yml']) && bad(['src/data/listings/approved/other-slug.json']) && bad(['src/data/listings/compliance.json']);
  })());
  t('a slug that could escape the folder is refused before any request', ['../x', 'a/b', 'A-b', '', 'a_b', 'a.json'].every((s) => { try { artifactPath(s); return false; } catch (e) { return e.code === 'bad_slug'; } }));
  t('the branch name is derived from the listing, version and content hash (so a retry finds it)', branchFor('lst_0123456789', 2, 'ab12cd34ef56aa') === 'publish/lst_0123456789-v2-ab12cd34ef');

  {
    const { s, gh } = fakeGitHub();
    const r = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'job-1', mode: 'publish' });
    t('opens a branch from main with exactly one file and one pull request', s.prs.length === 1 && r.prNumber === 7 && Object.keys(s.files[r.branch]).filter((k) => s.files[r.branch][k] !== s.files.main[k]).join() === artifactPath(SLUG) && s.files[r.branch][artifactPath(SLUG)] === snapshotText(snap()));
    t('the pull request and commit carry no listing content, only the slug, version and job id', !/test listing|price/i.test(`${s.prs[0].title}${s.prs[0].body}${s.lastCommit.message}`) && /job-1/.test(s.lastCommit.message));
    const again = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'job-1', mode: 'publish' });
    t('a retry reuses the same branch and pull request (idempotent)', s.prs.length === 1 && again.prNumber === r.prNumber && again.branch === r.branch);

    const c = await waitForChecks({ gh, branch: r.branch, headSha: r.headSha, sleep: noSleep });
    t('CI is started on the branch and the required check is awaited on the exact commit', c.ok && s.dispatches.join() === r.branch);
    const m = await mergePr({ gh, prNumber: r.prNumber, headSha: r.headSha, title: 't' });
    t('merges only the commit that passed, and main then holds the file', m.merged && s.files.main[artifactPath(SLUG)] === snapshotText(snap()) && s.merged.length === 1);
    const after = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'job-2', mode: 'publish' });
    t('after the merge a rerun sees the file already on main and opens nothing', after.alreadyOnMain === true && s.prs.length === 1);
    t('the token is never part of a request path or an error', !s.calls.join('\n').includes('tok_secret_value'));
  }
  {
    const { s, gh } = fakeGitHub({ alsoTouch: 'src/data/listings/compliance.json' });
    let err; try { await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' }); } catch (e) { err = e; }
    t('if the branch would change any other file the run stops before a pull request is opened', err?.code === 'unexpected_files' && s.prs.length === 0);
  }
  {
    const { s, gh } = fakeGitHub({ checkConclusion: 'failure' });
    const r = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' });
    const c = await waitForChecks({ gh, branch: r.branch, headSha: r.headSha, sleep: noSleep });
    t('a failed required check is reported and nothing merges', !c.ok && c.conclusion === 'failure' && s.merged.length === 0);
    let refused; try { await mergePr({ gh, prNumber: r.prNumber, headSha: r.headSha, title: 't' }); } catch (e) { refused = e; }
    t('even if the merge is attempted, the branch rules refuse and the refusal is not worked around', refused?.code === 'merge_refused' && s.merged.length === 0 && s.files.main[artifactPath(SLUG)] === undefined);
    await abandon({ gh, prNumber: r.prNumber, branch: r.branch });
    t('abandoning closes the pull request and deletes the branch; main is untouched', s.prs[0].state === 'closed' && !s.refs[r.branch] && s.files.main[artifactPath(SLUG)] === undefined);
  }
  {
    const { gh } = fakeGitHub({ checkPending: true });
    const r = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' });
    let clock = 0; const c = await waitForChecks({ gh, branch: r.branch, headSha: r.headSha, sleep: async (ms) => { clock += ms; }, now: () => clock, timeoutMs: 60000, pollMs: 10000 });
    t('a check that never finishes times out instead of waiting for ever', !c.ok && c.conclusion === 'timed_out');
  }
  {
    const { s, gh } = fakeGitHub({ state: { files: { main: { 'package.json': '{}\n', [artifactPath(SLUG)]: snapshotText(snap()) } } } });
    const r = await openPublicationPr({ gh, snapshot: snap({ version: 2, contentHash: 'ffeeddccbbaa00112233' }), slug: SLUG, jobId: 'j', mode: 'update' });
    t('an update changes the existing file on a new branch (it replaces the previous version, same single file)', s.files[r.branch][artifactPath(SLUG)] === snapshotText(snap({ version: 2, contentHash: 'ffeeddccbbaa00112233' })) && /Update/.test(s.prs[0].title));
  }

  section('real publication: deployment and live-site proof (fake GitHub, fake site)');
  {
    const { s, gh } = fakeGitHub({ state: { deployments: [{ id: 5, environment: 'Production' }] } });
    s.statuses[5] = [{ state: 'in_progress' }];
    let polls = 0; const sleep = async () => { polls += 1; if (polls === 2) s.statuses[5] = [{ state: 'success', environment_url: 'https://www.example.test' }]; };
    const d = await waitForDeployment({ gh, sha: 'c'.repeat(40), sleep });
    t('waits for the Production deployment of the merge commit until it succeeds', d.state === 'success' && polls === 2);
    s.statuses[5] = [{ state: 'failure' }];
    t('a failed deployment is reported as failed', (await waitForDeployment({ gh, sha: 'c'.repeat(40), sleep: noSleep })).state === 'failure');
    const none = fakeGitHub();
    let clock = 0; t('with no deployment record the site check decides (null, after the discovery window)', (await waitForDeployment({ gh: none.gh, sha: 'c'.repeat(40), sleep: async (ms) => { clock += ms; }, now: () => clock })) === null);
  }
  {
    const photos = [{ id: 'aaaaaaaaaaaa', src: 'https://media.test/lst_x/aaaaaaaaaaaa-1600.webp' }, { id: 'bbbbbbbbbbbb', src: 'https://media.test/lst_x/bbbbbbbbbbbb-1600.webp' }];
    const site = (o = {}) => async (url) => {
      const u = new URL(url); const res = (status, body = '', type = 'text/html') => ({ ok: status < 400, status, headers: new Headers({ 'content-type': type }), text: async () => body, body: null });
      if (u.hostname === 'media.test') return o.badImage && u.pathname.includes('bbbb') ? res(404) : res(200, '', 'image/webp');
      if (u.pathname === `/opportunities/${SLUG}/`) return o.noPage ? res(404) : res(200, `<h1>Tom &amp; Jerry&#39;s home</h1><img src="${photos[o.swap ? 1 : 0].src}"><img src="${photos[o.swap ? 0 : 1].src}">`);
      if (u.pathname === '/opportunities/') return o.noCatalogue ? res(200, 'nothing') : res(200, `<a href="/opportunities/${SLUG}/">x</a>`);
      return res(404);
    };
    const args = { siteUrl: 'https://www.example.test', slug: SLUG, title: "Tom & Jerry's home", photos, sleep: noSleep, attempts: 2 };
    const ok = await verifyLive({ ...args, fetchImpl: site() });
    t('live proof: page, title, every image in the approved order, and the catalogue all pass', ok.ok && ok.checks.length === 5 && ok.url === `https://www.example.test/opportunities/${SLUG}/`);
    t('live proof fails when the page is missing', !(await verifyLive({ ...args, fetchImpl: site({ noPage: true }) })).ok);
    t('live proof fails when an image is missing', !(await verifyLive({ ...args, fetchImpl: site({ badImage: true }) })).ok);
    t('live proof fails when the gallery order differs from the approved order', !(await verifyLive({ ...args, fetchImpl: site({ swap: true }) })).ok);
    t('live proof fails when the catalogue does not list the page', !(await verifyLive({ ...args, fetchImpl: site({ noCatalogue: true }) })).ok);
    let n = 0; const flaky = async (...a) => (n++ < 6 ? { ok: false, status: 404, headers: new Headers(), text: async () => '', body: null } : site()(...a));
    t('while the new deployment propagates the proof retries and then succeeds', (await verifyLive({ ...args, attempts: 4, fetchImpl: flaky })).ok);
  }
}
