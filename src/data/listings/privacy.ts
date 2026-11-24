import { DESIGN_LABEL } from './schema';

/*
  Participant names are never published. This is the ONE place that decides whether public text names a person who lives in (or is a tenant of) a property.

  The rule, in full:
    1. A person keyword: participant, resident or tenant (singular or plural, with or without 's), or an honorific (Mr, Mrs, Ms, Miss, Mx, Dr).
    2. Immediately after it (optionally after a colon, bracket, dash, or "named / called / known as / name is"), a RUN of capitalised words: up to four, hyphens and apostrophes allowed.
    3. The run is a name unless EVERY word in it is SDA or property vocabulary (SDA_VOCABULARY below). One word that is not vocabulary makes the whole run a name, wherever it stands in the run,
       so vocabulary can never be used to hide a name: "participant High Physical Support" is fine, "participant High Smith" and "participant High Physical Support Jane Smith" are not.
    4. After "named / called / known as / name is" the words are a name whatever they are.
  Honorifics (Mr Smith) are always a name.

  Vocabulary is a list of WORDS that are never a person's given name or surname, not a list of phrases to allow. It is built from the design-category names plus ordinary SDA, property and listing
  words. Adding a word needs a reviewed change here and must keep the corpus test (scripts/test-privacy-corpus.mjs) passing.

  Limits (stated, not hidden): this is a heuristic over English text. It does not detect a name that is not next to one of these keywords ("Jane lives in the front room"), names written in
  lower case, initials, nicknames, or a name hidden in a photograph's description (the photo and gallery checks cover file names and alt text separately). A person reviewing the text is
  still the final control, which is why the Publisher declares responsibility before anything is published. An ambiguous match is resolved by rewording (for example "participants", or the design
  category on its own); there is no switch that turns the rule off.
*/
const DESIGN_WORDS = Object.values(DESIGN_LABEL).flatMap((l) => l.split(/\s+/));
const VOCAB = [
  ...DESIGN_WORDS, 'High', 'Physical', 'Support', 'Supported', 'Improved', 'Liveability', 'Livability', 'Fully', 'Accessible', 'Robust', 'Basic',
  'Onsite', 'Overnight', 'Assistance', 'Specialist', 'Disability', 'Accommodation', 'SDA', 'NDIS', 'NDIA', 'SIL', 'OOA', 'HPS', 'IL', 'FA', 'Participant', 'Participants', 'Resident', 'Residents', 'Tenant', 'Tenants',
  'Place', 'Places', 'Capacity', 'Dwelling', 'Dwellings', 'Housing', 'Home', 'Homes', 'House', 'Houses', 'Villa', 'Villas', 'Unit', 'Units', 'Apartment', 'Apartments', 'Duplex', 'Townhouse', 'Room', 'Rooms',
  'Bedroom', 'Bedrooms', 'Bathroom', 'Bathrooms', 'Service', 'Services', 'Provider', 'Providers', 'Funding', 'Funded', 'Plan', 'Plans', 'Ready', 'Friendly', 'Care', 'Tenancy', 'Lease', 'Leased',
  'Occupied', 'Occupancy', 'Vacant', 'Income', 'Investment', 'Property', 'Properties', 'Opportunity', 'Detail', 'Details', 'Facilities', 'Feature', 'Features', 'Design', 'Category', 'Categories',
  'Group', 'Groups', 'Floor', 'Garage', 'Parking', 'Lock', 'Single', 'Double', 'Freehold', 'Passive', 'Management', 'Managed', 'Full', 'Established', 'Purpose', 'Built', 'Modern', 'Quality', 'Secure',
  'Safe', 'Open', 'Plan', 'Living', 'Kitchen', 'Bathroom', 'Laundry', 'Garden', 'Yard', 'Backyard', 'Courtyard', 'Wheelchair', 'Ramp', 'Hoist', 'Fire', 'Sprinklers', 'Backup', 'Generator', 'Smart', 'Home',
  'Automation', 'Technology', 'Assistive', 'Breakout', 'Space', 'Carer', 'Carers', 'Staff', 'Overnight', 'Awake', 'Shared', 'Individual', 'Independent', 'Supported', 'Needs', 'Level', 'Levels', 'Manager', 'Coordinator', 'Officer', 'Team', 'Worker', 'Workers', 'Agency', 'Agent', 'Company', 'Association',
];
const VOCAB_SET = new Set(VOCAB.map((w) => w.toLowerCase()));
/** A word is vocabulary when every capitalised part of it is ("NDIA-enrolled" is; "Lee-Smith" is not). Lower-case parts are ordinary words and never names. */
export const isSdaVocabulary = (word: string): boolean => word.split(/[-–]/).filter((part) => /^[A-Z]/.test(part)).every((part) => VOCAB_SET.has(part.toLowerCase().replace(/[’']s$/, '')));

const TOKEN = /^[A-Z][A-Za-z'’-]*/;
const KEYWORD = /\b(?:participants?|residents?|tenants?)(?:['’]s)?\b/gi;
const HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+[A-Z][a-z'’-]+/g;
// A line break ends a run: the text is scanned with its line structure, so a list marker at the start of the next line ("- NDIA-enrolled ...") is never read as "participant - Name".
const CONNECTOR = /^(?:[ \t]*[:(\-–—,][ \t]*|[ \t]+)(?:(?:named|called|known[ \t]+as|name[ \t]+is)[ \t]+)?/i;
const NAMING = /^(?:[ \t]*[:(\-–—,][ \t]*|[ \t]+)(?:named|called|known[ \t]+as|name[ \t]+is)[ \t]+/i;
/** "participant High Physical Support, named Jane": the naming words later in the same sentence still make what follows a name. */
const LATER_NAMING = /\b(?:participants?|residents?|tenants?)\b[^.\n]{0,60}?\b(?:named|called|known[ \t]+as|name[ \t]+is)[ \t]+[A-Z][A-Za-z'’-]+(?:[ \t]+[A-Z][A-Za-z'’-]+)?/gi;
const MAX_RUN = 4;

/** Every fragment of the text that reads as a person's name, in order, with what made it one. Pure. */
export const findPersonalNames = (text: string): { fragment: string; kind: 'participant' | 'named' | 'honorific' }[] => {
  const out: { fragment: string; kind: 'participant' | 'named' | 'honorific' }[] = [];
  const t = String(text ?? '');
  for (const m of t.matchAll(KEYWORD)) {
    const after = t.slice((m.index ?? 0) + m[0].length);
    const c = CONNECTOR.exec(after);
    if (!c) continue;
    const named = NAMING.test(after);
    let rest = after.slice(c[0].length); let consumed = c[0].length; const run: string[] = [];
    while (run.length < MAX_RUN) {
      const tok = TOKEN.exec(rest);
      if (!tok) break;
      run.push(tok[0]); const gap = /^[ \t]+/.exec(rest.slice(tok[0].length)); rest = rest.slice(tok[0].length + (gap ? gap[0].length : 0)); consumed += tok[0].length + (gap ? gap[0].length : 0);
      if (!gap) break;
    }
    if (!run.length) continue;
    // one word that is not vocabulary makes the whole run a name; "named ..." makes it a name whatever the words are
    if (named || run.some((w) => !isSdaVocabulary(w))) out.push({ fragment: `${m[0]}${after.slice(0, consumed)}`.trimEnd(), kind: named ? 'named' : 'participant' });
  }
  for (const n of t.matchAll(LATER_NAMING)) if (!out.some((o) => n[0].startsWith(o.fragment) && o.kind === 'named')) out.push({ fragment: n[0].trimEnd(), kind: 'named' });
  for (const h of t.matchAll(HONORIFIC)) out.push({ fragment: h[0], kind: 'honorific' });
  return out;
};

/** The first fragment that reads as a person's name, or null. Used by the safety scan and by the Listings Manager (it shows the person exactly which words to change). */
export const findNamedParticipant = (text: string): string | null => findPersonalNames(text)[0]?.fragment ?? null;
