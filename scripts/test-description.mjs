// The description: long text, lists and headings, how it is read for display, and that the publication safety checks are unchanged. Synthetic data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, repoRoot } from './lib/bundle-ts.mjs';
import { overlayPage, paragraphs as jobParagraphs } from './lib/publish-job.mjs';

export default async function run({ t, section }) {
  const L = await loadTs();
  const rd = (f) => readFileSync(join(repoRoot, f), 'utf8');
  const NT = JSON.parse(rd('src/data/listings/approved/whipray-circuit-berrimah-nt.json'));
  const content = (description, mod) => { const c = structuredClone(NT.content); c.description = description; for (const photo of c.photos) for (const variant of photo.variants) variant.src = `/images/listings/${variant.src.split('/').pop()}`; if (mod) mod(c); return c; };
  // Use a local synthetic media origin so this description test does not depend on CI configuration.
  const ctx = { allowDemo: false };
  const EXAMPLE = [
    'An opportunity to secure a fully occupied, established Improved Liveability (IL) Specialist Disability Accommodation investment in Armstrong Creek, within the growing Geelong region.',
    'Investment summary:\n- Gross income: $164,435 p.a. (FY26)\n- Net operating income: $132,704 p.a. (FY26)\n- Net yield: 11.1%\n- 100% occupied with 3 SDA participants',
    'Property summary:\n- Purpose-built Specialist Disability Accommodation\n- Improved Liveability (IL) design category\n- 3 participant places plus OOA',
  ];

  section('description: reading text into blocks');
  const raw = EXAMPLE.join('\n\n');
  t('blank lines separate blocks; line breaks inside a block are kept', L.descriptionBlocks(raw).length === 3 && L.descriptionBlocks(raw)[1].split('\n').length === 5);
  t('text without line breaks inside blocks reads exactly as it always did', JSON.stringify(L.descriptionBlocks('One  two\n\n\n  Three   four  ')) === JSON.stringify(['One two', 'Three four']));
  t('every existing published description reads back unchanged', ['rutherford-grove-armstrong-creek-vic', 'sheppard-street-shepparton-vic', 'whipray-circuit-berrimah-nt'].every((s) => { const c = JSON.parse(rd(`src/data/listings/approved/${s}.json`)).content.description; return JSON.stringify(L.descriptionBlocks(c.join('\n\n'))) === JSON.stringify(c); }));
  t('the publish job and the website normalise descriptions identically', jobParagraphs(raw).join('|') === L.descriptionBlocks(raw).join('|') && jobParagraphs('a  b\n\nc\nd\n\n').join('|') === L.descriptionBlocks('a  b\n\nc\nd\n\n').join('|'));
  t('the description survives the publish job overlay exactly (line breaks included), so the approval hash computed from the request text matches', (() => {
    const out = overlayPage({ properties: {} }, { content: { title: 'A valid title here', description: raw, publicAddress: 'A Street, Town NT 0800', pricingMode: 'contact_agent', displayPrice: null, featured: false } }, { notionUserId: null });
    return JSON.stringify(L.descriptionBlocks(L.readText(out.properties['Web Description']))) === JSON.stringify(L.descriptionBlocks(raw));
  })());
  t('more than eight paragraphs are accepted by the schema', L.publicContentSchema.safeParse(content(Array.from({ length: 40 }, (_, i) => `Paragraph number ${i + 1} of a long commercial description.`))).success);
  t('a long block, such as a full bullet list, is accepted', L.publicContentSchema.safeParse(content(['x'.repeat(4000)])).success);
  t('a description of more than 30,000 characters is refused', !L.publicContentSchema.safeParse(content(Array.from({ length: 10 }, () => 'y'.repeat(4000)))).success);
  t('an empty description is still refused', !L.publicContentSchema.safeParse(content([])).success);

  section('description: display blocks');
  const parsed = L.parseDescription(L.descriptionBlocks(raw));
  t('the first block is a paragraph', parsed[0].type === 'p' && /^An opportunity/.test(parsed[0].text));
  t('"Investment summary:" above bullets is a label followed by a real list of four items', parsed[1].type === 'label' && parsed[1].text === 'Investment summary:' && parsed[2].type === 'ul' && parsed[2].items.length === 4);
  t('bullet text is kept exactly', parsed[2].items[0] === 'Gross income: $164,435 p.a. (FY26)' && parsed[2].items[3] === '100% occupied with 3 SDA participants');
  t('the second labelled list is a label and a list of three', parsed[3].type === 'label' && parsed[4].type === 'ul' && parsed[4].items.length === 3);
  const hs = L.parseDescription(['First paragraph here, with some words.', 'Location', 'Another paragraph about the area and its amenities.', '## Features', '- Wide doorways']);
  t('a short line between blocks is a heading; "##" also makes one', hs[1].type === 'h' && hs[1].text === 'Location' && hs[3].type === 'h' && hs[3].text === 'Features');
  t('a short line ending in a colon keeps its colon and is a label (existing listings are unchanged in wording)', (() => { const x = L.parseDescription(['First paragraph here.', 'Key Property & Investment Highlights:', 'Next paragraph.']); return x[1].type === 'label' && x[1].text === 'Key Property & Investment Highlights:'; })());
  t('a short single-line paragraph as the last block stays a paragraph', L.parseDescription(['First paragraph here.', 'Contact us today'])[1].type === 'p');
  t('hard-wrapped lines join into one paragraph', L.parseDescription(['Line one of text\nline two of text.'])[0].text === 'Line one of text line two of text.');
  t('a wrapped bullet continues its item', L.parseDescription(L.descriptionBlocks('- First item\n  continues here\n- Second item'))[0].items[0] === 'First item continues here');
  t('no text is ever dropped: every word of the input is in the output', (() => { const words = (s) => s.replace(/[:#*•-]/g, ' ').split(/\s+/).filter(Boolean).join(' '); const out = parsed.map((b) => b.type === 'ul' ? b.items.join(' ') : b.text).join(' '); return words(out) === words(L.descriptionBlocks(raw).join(' ')); })());
  t('the intro is everything up to the first paragraph; the rest is expandable', (() => { const s = L.splitIntro(parsed); return s.intro.length === 1 && s.rest.length === parsed.length - 1; })());
  t('one paragraph alone has nothing to expand', L.splitIntro(L.parseDescription(['Only one paragraph here.'])).rest.length === 0);
  t('a heading before the first paragraph stays in the intro', (() => { const s = L.splitIntro(L.parseDescription(['## Welcome', 'The first paragraph.', 'More text.'])); return s.intro.length === 2 && s.rest.length === 1; })());
  t('cards and summaries use the first ordinary paragraph, never a heading or list line', L.firstParagraph(['## Welcome', 'The first paragraph is here.']) === 'The first paragraph is here.' && L.firstParagraph(EXAMPLE).startsWith('An opportunity'));
  t('markup is parsed as plain text (nothing is interpreted as HTML)', L.parseDescription(['<script>alert(1)</script> and <b>bold</b>'])[0].text === '<script>alert(1)</script> and <b>bold</b>');

  section('description: the component is server-rendered, escaped and script-free');
  const comp = rd('src/components/ListingDescription.astro');
  t('the expandable part is a native details element (no script, keyboard and screen reader support)', /<details class="dsc-more">/.test(comp) && !/<script/.test(comp) && /Read full description/.test(comp) && /Show less/.test(comp));
  t('text is output through Astro expressions (escaped), never as raw HTML', !/set:html|innerHTML/.test(comp));
  t('the listing page uses the component for the description', /<ListingDescription blocks=\{listing\.description\}/.test(rd('src/pages/opportunities/[slug].astro')));
  t('the component uses design tokens only (no hard-coded colours or font names)', !/#[0-9a-fA-F]{3,6}\b|rgb\(|Georgia|Arial/.test(comp.split('<style>')[1]));

  section('description: publication safety is unchanged');
  const issues = (desc, mod) => L.checkPublicSafety(content(desc, mod), ctx);
  t('a dollar amount in a description still blocks publication', issues(EXAMPLE).some((i) => /dollar amount or financial term/.test(i)));
  t('so does the word yield at the start of a line (a line break does not hide it)', issues(['A fine house.', 'Details\nYield: high\n- other']).some((i) => /financial term/.test(i)) && issues(['A fine house.\nyield is strong']).some((i) => /financial term/.test(i)));
  t('income wording is caught the same way', issues(['Net rent paid monthly.']).some((i) => /financial term/.test(i)));
  t('a plain description with no figures publishes', issues(['An established house.', 'Property summary:\n- Wide doorways\n- Two bathrooms']).length === 0);
  t('an email is still caught, and a phone number split by a line break is too', issues(['Call 0412\n345 678 today']).some((i) => /phone/.test(i)) && issues(['Write to a@b.com.au']).some((i) => /email/.test(i)));
  t('a house number next to the street name is still caught inside a list', issues(['A house.', '- Located at 12 Whipray Circuit']).some((i) => /house or unit number/.test(i)));
  t('the financial finder names what it found', (() => { const f = L.findFinancialMentions('Gross income: $164,435 p.a. Net yield: 11.1%'); return f.length === 2 && f.some((x) => x.startsWith('$164,435')) && f.includes('yield'); })());
  t('the finder finds nothing in a plain description', L.findFinancialMentions('Three participant places and onsite overnight assistance.').length === 0);
  t('ordinary words such as "return" or "income support" are not flagged', L.findFinancialMentions('Return to the entrance. Supported by income support services.').length === 0);
}
