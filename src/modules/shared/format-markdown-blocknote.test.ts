import { describe, expect, it } from 'vitest';

import {
  formatMarkdownToBlocknote,
  markdownToBlocknote,
} from './format-markdown-blocknote';

describe('markdownToBlocknote', () => {
  it('returns empty array for empty input', () => {
    expect(markdownToBlocknote('')).toEqual([]);
    expect(markdownToBlocknote('   ')).toEqual([]);
  });

  it('converts a single plain paragraph', () => {
    const blocks = markdownToBlocknote('Hello world.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'Hello world.', styles: {} },
    ]);
  });

  it('separates paragraphs by blank line', () => {
    const blocks = markdownToBlocknote('First.\n\nSecond.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('paragraph');
  });

  it('parses inline bold', () => {
    const blocks = markdownToBlocknote('Hello **world** today.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'Hello ', styles: {} },
      { type: 'text', text: 'world', styles: { bold: true } },
      { type: 'text', text: ' today.', styles: {} },
    ]);
  });

  it('parses asterisk italic', () => {
    const blocks = markdownToBlocknote('A *quick* note.');
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'A ', styles: {} },
      { type: 'text', text: 'quick', styles: { italic: true } },
      { type: 'text', text: ' note.', styles: {} },
    ]);
  });

  it('parses underscore italic', () => {
    const blocks = markdownToBlocknote('A _quick_ note.');
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'A ', styles: {} },
      { type: 'text', text: 'quick', styles: { italic: true } },
      { type: 'text', text: ' note.', styles: {} },
    ]);
  });

  it('parses level-2 heading', () => {
    const blocks = markdownToBlocknote('## My heading');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('heading');
    if (blocks[0].type === 'heading') {
      expect(blocks[0].props.level).toBe(2);
      expect(blocks[0].content).toEqual([
        { type: 'text', text: 'My heading', styles: {} },
      ]);
    }
  });

  it('parses level-3 heading', () => {
    const blocks = markdownToBlocknote('### Sub');
    expect(blocks[0].type).toBe('heading');
    if (blocks[0].type === 'heading') expect(blocks[0].props.level).toBe(3);
  });

  it('parses bullet list items', () => {
    const blocks = markdownToBlocknote('- one\n- two\n- three');
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.type === 'bulletListItem')).toBe(true);
    expect(blocks[0].content[0]).toMatchObject({
      type: 'text',
      text: 'one',
    });
  });

  it('parses asterisk-style bullets', () => {
    const blocks = markdownToBlocknote('* one\n* two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('bulletListItem');
  });

  it('parses horizontal rule', () => {
    const blocks = markdownToBlocknote('Above\n\n---\n\nBelow');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('horizontalRule');
    expect(blocks[2].type).toBe('paragraph');
  });

  it('parses asterisk horizontal rule', () => {
    const blocks = markdownToBlocknote('Above\n\n***\n\nBelow');
    expect(blocks[1].type).toBe('horizontalRule');
  });

  it('mixes paragraphs, headings and bullets', () => {
    const md = `# Bio

**Anna Kowalska** — kosmetolog.

## Topics

- cena
- rezerwacja

---

_Last refresh: 2026-05-10_`;
    const blocks = markdownToBlocknote(md);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      'heading', // # Bio
      'paragraph', // Anna Kowalska
      'heading', // ## Topics
      'bulletListItem',
      'bulletListItem',
      'horizontalRule',
      'paragraph', // _Last refresh..._
    ]);
  });

  it('every block has a stable shape (id, props, content, children)', () => {
    const blocks = markdownToBlocknote('hello');
    for (const b of blocks) {
      expect(b.id).toMatch(/^[0-9a-f-]+$/);
      expect(b.props).toBeDefined();
      expect(Array.isArray(b.content)).toBe(true);
      expect(b.children).toEqual([]);
    }
  });

  it('handles bold inside heading', () => {
    const blocks = markdownToBlocknote('## **Bold** title');
    expect(blocks[0].type).toBe('heading');
    expect(blocks[0].content[0]).toMatchObject({
      text: 'Bold',
      styles: { bold: true },
    });
  });
});

describe('formatMarkdownToBlocknote', () => {
  it('returns both markdown and JSON-stringified blocknote', () => {
    const result = formatMarkdownToBlocknote('Hello **world**');
    expect(result.markdown).toBe('Hello **world**');
    expect(typeof result.blocknote).toBe('string');
    const parsed = JSON.parse(result.blocknote) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('returns empty blocknote array for empty input', () => {
    const result = formatMarkdownToBlocknote('');
    expect(result.markdown).toBe('');
    expect(result.blocknote).toBe('[]');
  });
});
