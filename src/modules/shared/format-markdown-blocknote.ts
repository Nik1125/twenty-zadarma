import { randomUUID } from 'node:crypto';

// Convert a markdown string into a Twenty RICH_TEXT v2 payload (`{ markdown,
// blocknote }`). `blocknote` is the JSON-stringified BlockNote document; it is
// the source of truth for rendering on the record-show page. Mutations that
// send only `markdown` render as raw plaintext (with `**` and `##` visible)
// until the operator manually edits the field — see the
// `feedback_twenty_rich_text_blocknote_required` memory.
//
// Supported markdown features:
//   - paragraphs separated by blank lines
//   - inline `**bold**` and `*italic*` / `_italic_`
//   - `## H2` / `### H3` headings (`#` H1 also handled)
//   - `- bullet` / `* bullet` list items
//   - `---` / `***` horizontal rule
//
// Anything else falls through as plain paragraph text. This covers ~95% of
// LLM output (call summaries, biographies, classifier notes). For richer
// content (tables, code blocks, links) reach for `@blocknote/core` instead.
//
// Used by:
//   - `format-transcript-blocknote.ts` (call transcripts; specialised for
//     speaker turns, kept separate)
//   - external writers via `docs/SNIPPETS.md` (n8n Function nodes can
//     copy/paste a plain-JS port of this algorithm)

type InlineStyle = { bold?: true; italic?: true };
type InlineContent = { type: 'text'; text: string; styles: InlineStyle };

type BlockProps = {
  textColor: 'default';
  backgroundColor: 'default';
  textAlignment: 'left';
};
type HeadingProps = BlockProps & { level: 1 | 2 | 3 };

type ParagraphBlock = {
  id: string;
  type: 'paragraph';
  props: BlockProps;
  content: InlineContent[];
  children: [];
};
type HeadingBlock = {
  id: string;
  type: 'heading';
  props: HeadingProps;
  content: InlineContent[];
  children: [];
};
type BulletItemBlock = {
  id: string;
  type: 'bulletListItem';
  props: BlockProps;
  content: InlineContent[];
  children: [];
};
type HorizontalRuleBlock = {
  id: string;
  type: 'horizontalRule';
  props: BlockProps;
  content: [];
  children: [];
};

export type BlocknoteBlock =
  | ParagraphBlock
  | HeadingBlock
  | BulletItemBlock
  | HorizontalRuleBlock;

const DEFAULT_PROPS: BlockProps = {
  textColor: 'default',
  backgroundColor: 'default',
  textAlignment: 'left',
};

// Combined regex: bold first (longest), then asterisk-italic, then
// underscore-italic. Non-nested; sufficient for LLM output.
const INLINE_RE = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_)/g;

const parseInline = (text: string): InlineContent[] => {
  const out: InlineContent[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const pos = match.index ?? 0;
    if (pos > lastIndex) {
      out.push({
        type: 'text',
        text: text.slice(lastIndex, pos),
        styles: {},
      });
    }
    if (match[2] !== undefined) {
      out.push({ type: 'text', text: match[2], styles: { bold: true } });
    } else if (match[3] !== undefined) {
      out.push({ type: 'text', text: match[3], styles: { italic: true } });
    } else if (match[4] !== undefined) {
      out.push({ type: 'text', text: match[4], styles: { italic: true } });
    }
    lastIndex = pos + match[0].length;
  }
  if (lastIndex < text.length) {
    out.push({ type: 'text', text: text.slice(lastIndex), styles: {} });
  }
  return out.length > 0 ? out : [{ type: 'text', text, styles: {} }];
};

const makeParagraph = (text: string): ParagraphBlock => ({
  id: randomUUID(),
  type: 'paragraph',
  props: DEFAULT_PROPS,
  content: parseInline(text),
  children: [],
});

const makeHeading = (level: 1 | 2 | 3, text: string): HeadingBlock => ({
  id: randomUUID(),
  type: 'heading',
  props: { ...DEFAULT_PROPS, level },
  content: parseInline(text),
  children: [],
});

const makeBullet = (text: string): BulletItemBlock => ({
  id: randomUUID(),
  type: 'bulletListItem',
  props: DEFAULT_PROPS,
  content: parseInline(text),
  children: [],
});

const makeHr = (): HorizontalRuleBlock => ({
  id: randomUUID(),
  type: 'horizontalRule',
  props: DEFAULT_PROPS,
  content: [],
  children: [],
});

export const markdownToBlocknote = (markdown: string): BlocknoteBlock[] => {
  if (!markdown || markdown.trim() === '') return [];
  const blocks: BlocknoteBlock[] = [];
  const lines = markdown.split('\n');
  let paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(' ').trim();
    if (text !== '') blocks.push(makeParagraph(text));
    paragraphLines = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    if (trimmed === '---' || trimmed === '***') {
      flushParagraph();
      blocks.push(makeHr());
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push(makeHeading(level, heading[2].trim()));
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(makeBullet(bullet[1].trim()));
      continue;
    }
    paragraphLines.push(trimmed);
  }
  flushParagraph();

  return blocks;
};

export type FormatMarkdownToBlocknoteResult = {
  markdown: string;
  blocknote: string;
};

// Convenience wrapper that returns the full RICH_TEXT v2 payload. Pass the
// result straight into a Twenty `updateOne...` mutation as the field value.
export const formatMarkdownToBlocknote = (
  markdown: string,
): FormatMarkdownToBlocknoteResult => ({
  markdown,
  blocknote: JSON.stringify(markdownToBlocknote(markdown)),
});
