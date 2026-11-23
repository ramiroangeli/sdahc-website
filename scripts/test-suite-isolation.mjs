// The test suite must not depend on what is currently published. A real listing's approved content (for example commercial wording carried under a description approval) is
// legitimate to publish; if a test builds its synthetic listings from that live content, the suite breaks on the pull request AFTER the publication job has opened it (this happened
// to four publication attempts of one listing). Synthetic listings come from a frozen public base, and the job runs the suite on the same workspace the pull request will have.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  section('suite isolation: tests are independent of published content');
  const LIVE = /approved\/(whipray-circuit-berrimah-nt|rutherford-grove-armstrong-creek-vic|sheppard-street-shepparton-vic)\.json/;
  const offenders = readdirSync(join(repoRoot, 'scripts')).filter((f) => /^test-.*\.mjs$/.test(f) && f !== 'test-suite-isolation.mjs' && LIVE.test(rd(`scripts/${f}`)));
  t('no test builds a synthetic listing from a live published snapshot (only integrity checks of the real files read them, by name list)', offenders.every((f) => ['test-optional-fields.mjs', 'test-listings.mjs'].includes(f)), offenders.join(', '));
  const base = JSON.parse(rd('scripts/fixtures/base-whipray.json'));
  t('the frozen base is a plain public snapshot with no commercial groups, so it can never trip the privacy guard', base.content.slug === 'whipray-circuit-berrimah-nt' && !base.content.investment && !base.content.descriptionApproval && !base.content.location);
  const job = rd('scripts/listings-publish-job.mjs');
  const w = job.indexOf("writeFileSync(join(dataDir, 'approved', `${slug}.json`)"); const tests = job.indexOf("run('npm', ['run', 'test:listings'])");
  t('the publication job runs the suite AFTER the snapshot is in the workspace, so a failure the pull request would show is found before any pull request exists', w > 0 && tests > w);
}
