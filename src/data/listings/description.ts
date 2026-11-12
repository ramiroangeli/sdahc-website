/*
  The public description: how a staff-written text becomes stored blocks, and how stored blocks are read for display.

  Stored shape (unchanged contract): `description` is a list of text blocks. A block is what sits between blank lines. A block may hold several
  lines, because a bullet list is written as lines starting with "- ". Nothing is ever interpreted as HTML: the parser only classifies lines, and
  every piece of text is rendered as text by the page, so markup typed into a description is shown literally and never runs.

  Writing rules (also in docs/description-formatting.md):
    - a blank line starts a new block
    - lines starting with "- ", "* " or a bullet mark make a list
    - a line ending in ":" directly above a list is its label ("Investment summary:")
    - a short single line without final punctuation, between other blocks, is a heading; "# " or "## " also makes a heading
    - lines of one ordinary block are joined with a space, so text pasted with hard wraps reads as one paragraph
*/

/** Per block: collapse runs of spaces and tabs inside each line, drop empty lines, keep line breaks (they carry list structure). Pure. */
export const normaliseBlock = (block: string): string =>
  block.split('\n').map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).filter(Boolean).join('\n');

/** Splits raw text into stored blocks. A text with no line breaks inside blocks gives exactly what it always did. */
export const descriptionBlocks = (raw: string): string[] =>
  String(raw ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(normaliseBlock).filter(Boolean);

export type DescBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'label'; text: string }
  | { type: 'ul'; items: string[] };

const BULLET = /^(?:[-*\u2022\u2013])\s+(.*)$/;
const HEADING_MARK = /^#{1,3}\s+(.+)$/;
const isShortHeading = (line: string) => line.length <= 60 && !/[.!?,;]$/.test(line) && !BULLET.test(line) && !HEADING_MARK.test(line);

/** Reads stored blocks as display blocks. Never throws, never drops text. */
export const parseDescription = (blocks: readonly string[]): DescBlock[] => {
  const out: DescBlock[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split('\n');
    const last = bi === blocks.length - 1;
    const first = lines[0];
    const mark = HEADING_MARK.exec(first);
    if (mark) { out.push({ type: 'h', text: mark[1] }); lines.shift(); if (!lines.length) return; }
    else if (lines.length === 1 && bi > 0 && !last && !BULLET.test(first)) {
      // a short line ending in ":" keeps its colon and shows as a bold label; a short line with no final punctuation is a heading
      if (/:$/.test(first) && first.length <= 60 && !HEADING_MARK.test(first)) { out.push({ type: 'label', text: first }); return; }
      if (isShortHeading(first)) { out.push({ type: 'h', text: first }); return; }
    }
    let para: string[] = []; let items: string[] | null = null;
    const flushPara = () => {
      if (!para.length) return;
      const text = para.join(' ');
      out.push(/:$/.test(text) && text.length <= 80 && para.length === 1 ? { type: 'label', text } : { type: 'p', text });
      para = [];
    };
    const flushList = () => { if (items) { out.push({ type: 'ul', items }); items = null; } };
    for (const line of lines) {
      const b = BULLET.exec(line);
      if (b) { flushPara(); (items ??= []).push(b[1]); }
      else if (items) items[items.length - 1] += ' ' + line;
      else para.push(line);
    }
    // a label only counts when a list follows it in the same block; otherwise a line ending in ":" is ordinary text
    if (items) { if (para.length === 1 && /:$/.test(para[0]) && para[0].length <= 80) { out.push({ type: 'label', text: para[0] }); para = []; } flushPara(); flushList(); }
    else { const text = para.join(' '); para = []; if (text) out.push({ type: 'p', text }); }
  });
  return out;
};

/** The text of the first ordinary paragraph (cards and summaries use it). Falls back to the first line of anything. */
export const firstParagraph = (blocks: readonly string[]): string => {
  const p = parseDescription(blocks).find((b) => b.type === 'p');
  return p && p.type === 'p' ? p.text : String(blocks[0] ?? '').split('\n')[0] ?? '';
};

/** What shows before "Read full description": everything up to and including the first paragraph. The rest is expandable. */
export const splitIntro = (blocks: readonly DescBlock[]): { intro: DescBlock[]; rest: DescBlock[] } => {
  const i = blocks.findIndex((b) => b.type === 'p');
  const cut = i === -1 ? 1 : i + 1;
  return { intro: blocks.slice(0, cut), rest: blocks.slice(cut) };
};
