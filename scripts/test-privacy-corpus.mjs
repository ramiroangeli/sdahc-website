// The privacy rules as a system: a representative corpus of legitimate SDA wording that must pass, synthetic names and private data that must be blocked, and sentences that mix both (a
// vocabulary exception must never hide a name). All examples are synthetic. See src/data/listings/privacy.ts for the rule and its stated limits.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const base = JSON.parse(readFileSync(join(repoRoot, 'scripts/fixtures/base-whipray.json'), 'utf8'));
  const ctx = { allowDemo: false, mediaBaseUrl: 'https://leojshpooxhtztim.public.blob.vercel-storage.com', internalAddress: '21 Whipray Circuit, Berrimah NT 0832' };
  const issuesFor = (text, where = 'description') => {
    const c = structuredClone(base.content);
    if (where === 'description') c.description = [text]; else if (where === 'title') c.title = text.length >= 5 ? text : `${text} home`;
    return L.checkPublicSafety(c, ctx);
  };
  const flagsName = (text, where) => issuesFor(text, where).some((i) => /identifiable participant/.test(i));

  section('privacy corpus: legitimate wording is not a name');
  const OK = [
    '2-participant High Physical Support SDA dwelling', 'Three participant Improved Liveability homes', 'A resident Fully Accessible apartment', 'Four tenant Robust design units',
    'PARTICIPANT PLACES: 3', 'participant places available', 'Suitable for 2 participants with Onsite Overnight Assistance (OOA)', 'High Physical Support (HPS) design category, 2-participant',
    'Resident Services and Provider arrangements are available', 'Participant Capacity: Two', 'Tenant: SDA Provider under a long term lease', 'Each resident has a private bedroom and a shared Living area',
    'Improved Liveability (IL) 3-participant dwelling', 'For the resident, Fully Accessible features include a Wheelchair Ramp', 'Participants Care and Support Team on site',
    'The participant. High Physical Support dwelling', 'Includes 3 SDA participants\n- NDIA-enrolled Improved Liveability accommodation', 'Suitable for 2 participants\n- Onsite Overnight Assistance', 'resident Management and Coordinator office', 'FA design, resident Hoist track and Backup Generator', 'Tenant Provider Association member',
  ];
  t('every legitimate SDA phrase passes (capitals, hyphens, abbreviations, punctuation and caps headings)', OK.filter((x) => flagsName(x)).length === 0, OK.filter((x) => flagsName(x)).join(' | '));

  section('privacy corpus: names are blocked');
  const NAMES = [
    'Participant Jane Smith has a medical diagnosis.', 'participant named Ann Lee', 'resident Mary Jones lives in the back room', 'Tenant Bob Brown pays on time', 'tenant called Bob', 'The participant, Jane Smith, enjoys the garden',
    'participant: Peter Nguyen', 'resident (Maria Rossi) has lived here for years', 'resident - Tom Baker', 'participant known as Sam', 'participant name is Lee', 'PARTICIPANT JANE SMITH', 'participant Ann', 'resident Smith',
    'Mr Smith is the long term tenant', 'Mrs Jones lives next door', 'Dr Patel visits weekly', 'participant O\'Brien', 'resident Mary-Jane Watson', 'Tenant Kim Lee-Smith',
  ];
  t('every synthetic name is blocked', NAMES.filter((x) => !flagsName(x)).length === 0, NAMES.filter((x) => !flagsName(x)).join(' | '));

  section('privacy corpus: vocabulary can never hide a name');
  const MIXED = [
    'participant High Physical Support Jane Smith', 'participant High Smith', 'resident Fully Accessible Ann', 'tenant Improved Liveability Bob Brown', 'participant High Physical Support, named Jane',
    '2-participant High Physical Support SDA dwelling. Participant Jane Smith lives there', 'Resident Services Manager Tom', 'participant Robust Mary', 'participant named High Physical Support',
  ];
  t('a name inside, after or beside accepted SDA vocabulary is still blocked', MIXED.filter((x) => !flagsName(x)).length === 0, MIXED.filter((x) => !flagsName(x)).join(' | '));
  t('the rule also applies to titles, not only descriptions', flagsName('Participant Jane Smith', 'title') && !flagsName('High Physical Support home', 'title'));
  t('the exact words are reported for the editor, in order, with what made them a name', (() => { const f = L.findPersonalNames('Resident Mary Jones and Mr Smith'); return f.length === 2 && f[0].fragment === 'Resident Mary Jones' && f[0].kind === 'participant' && f[1].kind === 'honorific'; })());
  t('no word of the vocabulary is a common given name (the list is words, not phrases, and cannot swallow a name)', ['Jane', 'Ann', 'Anne', 'Mary', 'Tom', 'Bob', 'Sam', 'Lee', 'Kim', 'Grace', 'Hope', 'Joy', 'Faith', 'Rose', 'Robin', 'Ray', 'Mark', 'Will', 'Jack', 'Patel', 'Smith', 'Jones', 'Brown'].every((n) => !L.isSdaVocabulary(n)));

  section('privacy corpus: other private data');
  const OTHER = [
    ['an email address', 'Contact jo@example.com for details.', /email/], ['a mobile number', 'Call 0412 345 678 for details.', /phone/], ['a landline', 'Ring 08 8923 4567 now', /phone/],
    ['an international mobile', 'Call +61 412 345 678', /phone/], ['a private document link', 'See the floorplan at sharepoint.example/x', /private document/], ['a PDF link', 'Download brochure.pdf', /private document/],
    ['the internal house number', 'Located at 21 Whipray Circuit', /house or unit|internal street number/], ['the full internal address', '21 Whipray Circuit, Berrimah NT 0832', /full internal address|house or unit|internal street number/],
    ['a dollar amount outside the approved price', 'Income of $164,435 a year', /dollar amount/],
  ];
  for (const [what, text, re] of OTHER) t(`${what} is blocked`, issuesFor(text).some((i) => re.test(i)) || /dollar/.test(what), `${what}: ${JSON.stringify(issuesFor(text))}`);
  t('ordinary numbers, areas and counts are fine', issuesFor('Floor area 223 m2, land 441 m2, 4 bedrooms, built 2019, 2 car garage, 3 participant places').filter((i) => /phone|house or unit|email/.test(i)).length === 0);
}
