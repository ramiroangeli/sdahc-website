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
    if (method === 'GET' && (m = path.match(/^\/contents\/(.+)$/))) { const f = s.files[u.searchParams.get('ref')]?.[decodeURIComponent(m[1])]; return f === undefined ? json(404, {}) : json(200, { sha: sha1(f), content: Buffer.from(f, 'utf8').toString('base64'), encoding: 'base64' }); }
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
    if (method === 'POST' && path === '/pulls') { const p = { number: s.prs.length + 7, state: 'open', head: body.head, html_url: `https://github.example/pull/${s.prs.length + 7}`, title: body.title, body: body.body }; s.prs.push(p);
      // a pull request opened with the GitHub App token starts the normal pull_request run of ci.yml on its head commit (opts.noCheck: it does not)
      if (!opts.noCheck) s.checkRuns[s.refs[body.head]] = [{ id: rid(), name: REQUIRED_CHECK, status: opts.checkPending ? 'in_progress' : 'completed', conclusion: opts.checkPending ? null : (opts.checkConclusion ?? 'success'), html_url: 'https://github.example/run/1' }];
      return json(201, p); }
    if (method === 'PATCH' && (m = path.match(/^\/pulls\/(\d+)$/))) { const p = s.prs.find((x) => x.number === Number(m[1])); p.state = body.state; return json(200, p); }
    if (method === 'DELETE' && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) { delete s.refs[m[1]]; delete s.files[m[1]]; return json(204, {}); }
    if (method === 'POST' && /^\/actions\/workflows\/[^/]+\/dispatches$/.test(path)) { s.dispatches.push(body.ref); return { ok: true, status: 204, headers: new Headers(), json: async () => { throw new Error('no body'); } }; } // a manual run never counts as the required check
    if (method === 'GET' && (m = path.match(/^\/commits\/([0-9a-f]+)\/check-runs$/))) return json(200, { check_runs: s.checkRuns[m[1]] ?? [] });
    if (method === 'PUT' && (m = path.match(/^\/pulls\/(\d+)\/merge$/))) {
      const p = s.prs.find((x) => x.number === Number(m[1]));
      const ok = (s.checkRuns[s.refs[p.head]] ?? []).some((r) => r.name === REQUIRED_CHECK && r.conclusion === 'success');
      if (body.sha !== s.refs[p.head]) return json(409, { message: 'head changed' });
      s.mergeTries = (s.mergeTries ?? 0) + 1;
      if (!ok || opts.refuseMerge || s.mergeTries <= (opts.mergeFlaky ?? 0)) return json(405, { message: 'Required status check is expected.' });
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

    const c = await waitForChecks({ gh, headSha: r.headSha, sleep: noSleep });
    t('the required check is the pull request\'s own run on the exact commit; nothing is dispatched by hand', c.ok && s.dispatches.length === 0 && s.checkRuns[r.headSha]?.length === 1);
    const m = await mergePr({ gh, prNumber: r.prNumber, headSha: r.headSha, title: 't', sleep: noSleep });
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
    const c = await waitForChecks({ gh, headSha: r.headSha, sleep: noSleep });
    t('a failed required check is reported and nothing merges', !c.ok && c.conclusion === 'failure' && s.merged.length === 0);
    let refused; try { await mergePr({ gh, prNumber: r.prNumber, headSha: r.headSha, title: 't', sleep: noSleep }); } catch (e) { refused = e; }
    t('even if the merge is attempted, the branch rules refuse and the refusal is not worked around (only a short, bounded retry)', refused?.code === 'merge_refused' && s.merged.length === 0 && s.mergeTries === 4 && s.files.main[artifactPath(SLUG)] === undefined);
    await abandon({ gh, prNumber: r.prNumber, branch: r.branch });
    t('abandoning closes the pull request and deletes the branch; main is untouched', s.prs[0].state === 'closed' && !s.refs[r.branch] && s.files.main[artifactPath(SLUG)] === undefined);
  }
  {
    const { gh } = fakeGitHub({ checkPending: true });
    const r = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' });
    let clock = 0; const c = await waitForChecks({ gh, headSha: r.headSha, sleep: async (ms) => { clock += ms; }, now: () => clock, timeoutMs: 60000, pollMs: 10000 });
    t('a check that never finishes times out instead of waiting for ever', !c.ok && c.conclusion === 'timed_out');
  }
  {
    const { s, gh } = fakeGitHub({ noCheck: true });
    const r = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' });
    let clock = 0; const c = await waitForChecks({ gh, headSha: r.headSha, sleep: async (ms) => { clock += ms; }, now: () => clock, pollMs: 10000 });
    t('if the pull request never gets its own check run the job stops ("not_started"); it is not started by hand and nothing merges', !c.ok && c.conclusion === 'not_started' && s.dispatches.length === 0 && s.merged.length === 0 && clock > 180000 && clock < 200000);
  }
  {
    const { s, gh } = fakeGitHub({ mergeFlaky: 2 });
    const r = await openPublicationPr({ gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' });
    await waitForChecks({ gh, headSha: r.headSha, sleep: noSleep });
    const m = await mergePr({ gh, prNumber: r.prNumber, headSha: r.headSha, title: 't', sleep: noSleep });
    t('a merge refused for a moment (GitHub still registering the finished check) succeeds on a later attempt', m.merged && s.mergeTries === 3 && s.merged.length === 1);
    const wrong = fakeGitHub(); const r2 = await openPublicationPr({ gh: wrong.gh, snapshot: snap(), slug: SLUG, jobId: 'j', mode: 'publish' });
    let e409; try { await mergePr({ gh: wrong.gh, prNumber: r2.prNumber, headSha: 'f'.repeat(40), title: 't', sleep: noSleep }); } catch (e) { e409 = e; }
    t('a merge of any commit other than the one that passed is refused at once (409), not retried', e409?.code === 'merge_refused' && e409.status === 409 && wrong.s.mergeTries === undefined);
  }
  {
    const { s, gh } = fakeGitHub({ state: { files: { main: { 'package.json': '{}\n', [artifactPath(SLUG)]: snapshotText(snap()) } } } });
    const r = await openPublicationPr({ gh, snapshot: snap({ version: 2, contentHash: 'ffeeddccbbaa00112233' }), slug: SLUG, jobId: 'j', mode: 'update' });
    t('an update changes the existing file on a new branch (it replaces the previous version, same single file)', s.files[r.branch][artifactPath(SLUG)] === snapshotText(snap({ version: 2, contentHash: 'ffeeddccbbaa00112233' })) && /Update/.test(s.prs[0].title));
  }

  {
    const prev = snap({ version: 2, contentHash: 'ffeeddccbbaa00112233', commercialStatus: 'available' });
    const { s, gh } = fakeGitHub({ state: { files: { main: { 'package.json': '{}\n', [artifactPath(SLUG)]: snapshotText(prev) } } } });
    const sold = { ...prev, commercialStatus: 'sold' };
    const r = await openPublicationPr({ gh, snapshot: sold, slug: SLUG, jobId: 'job-s', mode: 'update' });
    t('a status-only change keeps the version and content hash, so it gets its own branch, still one file', r.branch !== branchFor(prev.listingId, 2, prev.contentHash) && r.branch.startsWith(branchFor(prev.listingId, 2, prev.contentHash)) && s.files[r.branch][artifactPath(SLUG)] === snapshotText(sold));
    t('the status change pull request and commit say what changed publicly and name no person', r.title === `Update ${SLUG} (status: sold)` && s.lastCommit.message.startsWith(`Update ${SLUG} (status: sold)`) && !/@|Approved by/.test(s.lastCommit.message + r.title));
    const again = await openPublicationPr({ gh, snapshot: sold, slug: SLUG, jobId: 'job-s', mode: 'update' });
    t('repeating the status change finds the same branch and pull request', again.branch === r.branch && again.prNumber === r.prNumber);
    const back = await openPublicationPr({ gh, snapshot: { ...prev, commercialStatus: 'under_offer' }, slug: SLUG, jobId: 'job-t', mode: 'update' });
    t('a different status gets a different branch (no collision with the earlier one)', back.branch !== r.branch);
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
    const siteS = (status, o = {}) => async (url) => { const u = new URL(url); const base = await site()(url); if (u.pathname !== `/opportunities/${SLUG}/`) return base; const html = `<h1>Tom &amp; Jerry&#39;s home</h1><span class="lsb lsb-${o.wrong ?? status}">x</span>${o.form ? '<form data-le-form></form> Enquire about this property' : ''}<img src="${photos[0].src}"><img src="${photos[1].src}">`; return { ...base, text: async () => html }; };
    const soldOk = await verifyLive({ ...args, status: 'sold', fetchImpl: siteS('sold') });
    t('live proof of a Sold listing also checks the status badge and that the page does not offer it for enquiry', soldOk.ok && soldOk.checks.some((c) => c.name === 'listing_status') && soldOk.checks.some((c) => c.name === 'sold_page'));
    t('live proof fails when the page still shows another status', !(await verifyLive({ ...args, status: 'sold', fetchImpl: siteS('sold', { wrong: 'available' }) })).ok);
    t('live proof fails when a Sold page still carries the enquiry form', !(await verifyLive({ ...args, status: 'sold', fetchImpl: siteS('sold', { form: true }) })).ok);
    t('an Under offer page keeps its enquiry form and passes', (await verifyLive({ ...args, status: 'under_offer', fetchImpl: siteS('under_offer', { form: true }) })).ok);
    t('live proof fails when the catalogue does not list the page', !(await verifyLive({ ...args, fetchImpl: site({ noCatalogue: true }) })).ok);
    let n = 0; const flaky = async (...a) => (n++ < 6 ? { ok: false, status: 404, headers: new Headers(), text: async () => '', body: null } : site()(...a));
    t('while the new deployment propagates the proof retries and then succeeds', (await verifyLive({ ...args, attempts: 4, fetchImpl: flaky })).ok);
  }
}
