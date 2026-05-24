import { describe, expect, it } from 'vitest';

import {
  attachAudioToRichText,
  buildAudioBlock,
  fileNameFromUrl,
} from './attach-recording-audio';

const ZADARMA_URL =
  'https://api.zadarma.com/v1/pbx/record/download/tok1/tok2/531638-1779468006.16770855-102-2026-05-22-184007.mp3';

describe('fileNameFromUrl', () => {
  it('takes the last path segment', () => {
    expect(fileNameFromUrl(ZADARMA_URL)).toBe(
      '531638-1779468006.16770855-102-2026-05-22-184007.mp3',
    );
  });

  it('strips the query string (signed URLs)', () => {
    expect(
      fileNameFromUrl('https://d1.cloudfront.net/abc/recording.wav?Expires=1'),
    ).toBe('recording.wav');
  });

  it('falls back to "recording" for trailing-slash / odd URLs', () => {
    expect(fileNameFromUrl('https://x.test/')).toBe('recording');
  });
});

describe('buildAudioBlock', () => {
  it('produces a BlockNote audio block with the URL and showPreview', () => {
    const b = buildAudioBlock(ZADARMA_URL, 'rec.mp3', 'fixed-id');
    expect(b.type).toBe('audio');
    expect(b.id).toBe('fixed-id');
    expect(b.props.url).toBe(ZADARMA_URL);
    expect(b.props.name).toBe('rec.mp3');
    expect(b.props.showPreview).toBe(true);
  });
});

describe('attachAudioToRichText', () => {
  const transcript = {
    markdown: '**Klient:** Tak.',
    blocknote: JSON.stringify([
      { id: 'p1', type: 'paragraph', props: {}, content: [], children: [] },
    ]),
  };

  it('prepends the audio block as the first block', () => {
    const out = attachAudioToRichText(transcript, ZADARMA_URL, 'rec.mp3');
    const blocks = JSON.parse(out.blocknote);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('audio');
    expect(blocks[0].props.url).toBe(ZADARMA_URL);
    expect(blocks[1].type).toBe('paragraph');
    expect(out.markdown.startsWith('[rec.mp3](')).toBe(true);
    expect(out.markdown).toContain('**Klient:** Tak.');
  });

  it('is idempotent: re-running replaces the leading audio block, not stacks', () => {
    const once = attachAudioToRichText(transcript, ZADARMA_URL, 'rec.mp3');
    const twice = attachAudioToRichText(once, ZADARMA_URL, 'rec.mp3');
    const blocks = JSON.parse(twice.blocknote);
    expect(blocks.filter((b: { type: string }) => b.type === 'audio')).toHaveLength(1);
    expect(blocks).toHaveLength(2);
    // markdown also stays single-link
    expect(twice.markdown.match(/\]\(https/g) ?? []).toHaveLength(1);
  });

  it('refreshes the URL when re-run with a new recording link', () => {
    const once = attachAudioToRichText(transcript, ZADARMA_URL, 'old.mp3');
    const fresh = attachAudioToRichText(once, 'https://x.test/new.mp3', 'new.mp3');
    const blocks = JSON.parse(fresh.blocknote);
    expect(blocks[0].props.url).toBe('https://x.test/new.mp3');
    expect(blocks.filter((b: { type: string }) => b.type === 'audio')).toHaveLength(1);
  });

  it('returns content unchanged when url is empty (no dead player)', () => {
    const out = attachAudioToRichText(transcript, '', 'rec.mp3');
    const blocks = JSON.parse(out.blocknote);
    expect(blocks.every((b: { type: string }) => b.type !== 'audio')).toBe(true);
  });

  it('handles empty/missing transcript: audio becomes the only block', () => {
    const out = attachAudioToRichText(null, ZADARMA_URL, 'rec.mp3');
    const blocks = JSON.parse(out.blocknote);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('audio');
    expect(out.markdown).toBe(`[rec.mp3](${ZADARMA_URL})`);
  });

  it('does not corrupt unparseable blocknote', () => {
    const bad = { markdown: 'x', blocknote: 'not json{' };
    const out = attachAudioToRichText(bad, ZADARMA_URL, 'rec.mp3');
    expect(out.blocknote).toBe('not json{');
  });
});
