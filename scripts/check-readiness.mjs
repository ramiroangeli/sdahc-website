#!/usr/bin/env node
/*
  Production-readiness checks for publishing the first listing. Read only: it inspects the repository, the
  GitHub rules (through `gh`, if available) and the configuration files. It changes nothing.

    node scripts/check-readiness.mjs [--github]

  Each line is PASS, FAIL or UNVERIFIED. UNVERIFIED means this tool cannot see the thing (for example Vercel
  environment variables) and a person must check it. Exit code 1 if anything FAILs.
*/
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/bundle-ts.mjs';

const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
const json = (f) => JSON.parse(rd(f));
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const rows = [];
const add = (area, status, note) => rows.push({ area, status, note });
const repo = 'ramiroangeli/sdahc-website';

// approvers and compliance
const approvers = json('src/data/listings/approvers.json').approvers;
add('Authorised approvers', approvers.length ? 'PASS' : 'FAIL', approvers.length ? `${approvers.length} configured` : 'approvers.json is empty: nobody can approve a listing yet');
const comp = json('src/data/listings/compliance.json');
const clearedModes = Object.entries(comp.victoria.cleared).filter(([, v]) => v).map(([k]) => k);
add('Victorian pricing compliance', clearedModes.length ? 'PASS' : 'FAIL', clearedModes.length ? `cleared for: ${clearedModes.join(', ')}` : 'no pricing mode is cleared for Victoria (legal classification outstanding)');

// automation safety
const wfDir = join(repoRoot, '.github/workflows');
const wfs = existsSync(wfDir) ? readdirSync(wfDir) : [];
const wfText = wfs.map((f) => readFileSync(join(wfDir, f), 'utf8').replace(/^\s*#.*$/gm, '')).join('\n');
add('No unsafe automation', !/schedule:|repository_dispatch|deploy.?hook|HEAD:main|push origin main/i.test(wfText) ? 'PASS' : 'FAIL', `${wfs.length} workflow(s); manual and pull-request only`);
add('No listing published automatically', !existsSync(join(repoRoot, 'src/data/listings/approved')) || readdirSync(join(repoRoot, 'src/data/listings/approved')).filter((f) => f.endsWith('.json')).length === 0 ? 'PASS' : 'FAIL', 'src/data/listings/approved contains no snapshot');
add('Secrets stay out of source control', /^\.env\.listings$/m.test(rd('.gitignore')) ? 'PASS' : 'FAIL', '.env.listings is git-ignored');

// CSP and media
const csp = json('vercel.json').headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
const imgSrc = /img-src([^;]*)/.exec(csp)?.[1] ?? '';
const media = process.env.LISTINGS_MEDIA_BASE_URL;
if (!media) add('Approved imagery can load (CSP)', 'UNVERIFIED', 'LISTINGS_MEDIA_BASE_URL is not set here; once the public store exists its origin must be added to img-src');
else { const origin = new URL(media).origin; add('Approved imagery can load (CSP)', imgSrc.includes(origin) ? 'PASS' : 'FAIL', imgSrc.includes(origin) ? `img-src allows ${origin}` : `img-src does not allow ${origin}: add it in vercel.json by pull request`); }

// enquiries
add('Enquiry delivery route', 'UNVERIFIED', 'Uses the same Resend sender and domain as the contact and opportunities handlers. Needs LISTINGS_ENQUIRY_MODE=email and RESEND_API_KEY in Vercel (Production and Preview); this tool cannot read Vercel');

// CODEOWNERS and repository rules
const codeowners = existsSync(join(repoRoot, '.github/CODEOWNERS'));
add('CODEOWNERS file', codeowners ? 'PASS' : 'FAIL', codeowners ? 'present on this branch' : 'missing');
const onMain = sh('git', ['cat-file', '-e', 'origin/main:.github/CODEOWNERS']) !== null || sh('git', ['show', 'origin/main:.github/CODEOWNERS']) !== null;
add('CODEOWNERS on main', onMain ? 'PASS' : 'FAIL', onMain ? 'present on origin/main' : 'not on main yet: it only takes effect after this branch is merged');
if (process.argv.includes('--github')) {
  const prot = sh('gh', ['api', `repos/${repo}/branches/main/protection`]);
  const rulesets = sh('gh', ['api', `repos/${repo}/rulesets`]);
  let codeOwnerRequired = false;
  if (prot) { try { codeOwnerRequired = JSON.parse(prot).required_pull_request_reviews?.require_code_owner_reviews === true; } catch { /* ignore */ } }
  let rs = [];
  try { rs = JSON.parse(rulesets ?? '[]'); } catch { /* ignore */ }
  add('Code owner review required on main', codeOwnerRequired || rs.length ? (codeOwnerRequired ? 'PASS' : 'UNVERIFIED') : 'FAIL', codeOwnerRequired ? 'branch protection requires code owner review' : rs.length ? `${rs.length} ruleset(s) exist; inspect them for the code owner rule` : 'main has no branch protection and no rulesets');
  const collabs = sh('gh', ['api', `repos/${repo}/collaborators`, '--jq', '[.[] | select(.permissions.push)] | length']);
  const n = Number(collabs);
  add('A second reviewer exists', n >= 2 ? 'PASS' : 'FAIL', n >= 2 ? `${n} collaborators can push` : 'one collaborator only: the author cannot approve their own pull request, so a code owner rule would block every merge (or be bypassed by an admin)');
  const vis = sh('gh', ['api', `repos/${repo}`, '--jq', '.private']);
  add('Repository visibility', vis?.trim() === 'true' ? 'PASS' : 'FAIL', vis?.trim() === 'true' ? 'private' : 'PUBLIC: approved snapshots, approver ids, withdrawal reasons, docs and git history are world-readable. Nothing internal may be committed');
} else add('Repository rules (GitHub)', 'UNVERIFIED', 'run with --github to inspect branch protection, rulesets, collaborators and visibility');

for (const r of rows) console.log(`${r.status.padEnd(10)} ${r.area}: ${r.note}`);
const fail = rows.filter((r) => r.status === 'FAIL').length;
console.log(`\n${rows.filter((r) => r.status === 'PASS').length} pass, ${fail} fail, ${rows.filter((r) => r.status === 'UNVERIFIED').length} unverified`);
process.exit(fail ? 1 : 0);
