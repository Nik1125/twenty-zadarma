import { randomUUID } from 'node:crypto';

import { CoreApiClient } from 'twenty-client-sdk/core';

// Embed the call recording as a BlockNote `audio` player at the top of the
// transcript, so an operator can listen inline above the text.
//
// GDPR — STORAGE LIMITATION (hard rule): we only ever embed a *link* to the
// source recording URL (Zadarma `callLog.recording.primaryLinkUrl`). We never
// download the audio or copy the bytes into Twenty. The source enforces
// retention on its own — Zadarma's recording store is a ring buffer (~200 MB)
// that overwrites oldest-first, Retell auto-deletes after its retention
// window — so when the source recording is gone the embedded link simply
// 404s and the CRM holds no rogue copy. Creating a second, longer-lived copy
// (attachment / blob) would defeat that and is explicitly out of scope.
//
// One recording per call, attached to whichever transcript field is
// populated: `aiTranscript` (Retell/AI calls) or `transcript` (manager/SR
// calls) — in practice mutually exclusive. The recording URL and the
// transcript arrive on different webhooks in an unpredictable order, so this
// is invoked from every write point (NOTIFY_RECORD, call-enrichment, SR push)
// and is idempotent: if the first block is already an audio block its URL is
// refreshed in place rather than stacking a second player.

type AudioBlock = {
  id: string;
  type: 'audio';
  props: {
    backgroundColor: 'default';
    name: string;
    url: string;
    caption: string;
    showPreview: true;
  };
  children: [];
};

type AnyBlock = { id?: string; type?: string; [k: string]: unknown };

export type RichText = { markdown: string; blocknote: string };

// Derive a display filename from the recording URL's last path segment
// (query string stripped). Falls back to "recording" for odd URLs.
export const fileNameFromUrl = (url: string): string => {
  const noQuery = url.split('?')[0] ?? '';
  // Drop scheme://host so a path-less URL falls back instead of returning the host.
  const path = noQuery.replace(/^[a-z][\w+.-]*:\/\/[^/]+/i, '').replace(/\/+$/, '');
  const base = path.substring(path.lastIndexOf('/') + 1);
  return base.length > 0 ? base : 'recording';
};

export const buildAudioBlock = (
  url: string,
  name: string,
  id: string = randomUUID(),
): AudioBlock => ({
  id,
  type: 'audio',
  props: {
    backgroundColor: 'default',
    name,
    url,
    caption: '',
    showPreview: true,
  },
  children: [],
});

// Prepend (or refresh) the audio block in a RICH_TEXT v2 `{ markdown,
// blocknote }` pair. Returns the original unchanged when `url` is empty or the
// blocknote can't be parsed (never corrupt existing content). Idempotent: a
// leading audio block / audio-link markdown line is replaced, not duplicated.
export const attachAudioToRichText = (
  rich: { markdown?: string | null; blocknote?: string | null } | null | undefined,
  url: string,
  name: string,
): RichText => {
  const markdown = rich?.markdown ?? '';
  const blocknoteRaw = rich?.blocknote ?? '';
  const current: RichText = {
    markdown,
    blocknote: blocknoteRaw.length > 0 ? blocknoteRaw : '[]',
  };
  if (!url) return current;

  let blocks: AnyBlock[];
  try {
    const parsed = blocknoteRaw.length > 0 ? JSON.parse(blocknoteRaw) : [];
    if (!Array.isArray(parsed)) return current;
    blocks = parsed as AnyBlock[];
  } catch {
    return current; // unparseable — leave as-is rather than risk data loss
  }

  const firstIsAudio = blocks.length > 0 && blocks[0]?.type === 'audio';
  const reuseId =
    firstIsAudio && typeof blocks[0]?.id === 'string'
      ? (blocks[0].id as string)
      : undefined;
  const audio = buildAudioBlock(url, name, reuseId);
  const rest = firstIsAudio ? blocks.slice(1) : blocks;
  const newBlocks = [audio, ...rest];

  // Markdown is secondary (blocknote is the render source of truth) but kept
  // in sync. Strip a previously-injected leading link line before prepending.
  const body = markdown.replace(/^\[[^\]]*\]\([^)]*\)\n\n?/, '');
  const audioMd = `[${name}](${url})`;
  const newMarkdown = body.length > 0 ? `${audioMd}\n\n${body}` : audioMd;

  return { markdown: newMarkdown, blocknote: JSON.stringify(newBlocks) };
};

// True when a transcript field holds real content (more than an empty doc or
// a lone audio block). Used to pick which transcript to attach the player to.
const hasTranscriptText = (rich: {
  markdown?: string | null;
  blocknote?: string | null;
}): boolean => {
  if ((rich.markdown ?? '').trim().length > 0) return true;
  try {
    const blocks = rich.blocknote ? JSON.parse(rich.blocknote) : [];
    if (!Array.isArray(blocks)) return false;
    return blocks.some((b: AnyBlock) => b?.type && b.type !== 'audio');
  } catch {
    return false;
  }
};

type CallLogTranscripts = {
  recording?: { primaryLinkUrl?: string | null } | null;
  transcript?: { markdown?: string | null; blocknote?: string | null } | null;
  aiTranscript?: { markdown?: string | null; blocknote?: string | null } | null;
};

export type SyncResult =
  | { updated: 'aiTranscript' | 'transcript' }
  | { skipped: 'no-recording' | 'no-transcript' | 'not-found' };

// Read a callLog's recording + both transcripts and ensure the recording
// player is the first block of whichever transcript holds text. Best-effort,
// idempotent. Returns what it did (for logging). Never throws on the happy
// path; callers should still wrap in try/catch so it can't break the webhook.
export const syncRecordingAudioBlock = async (
  client: CoreApiClient,
  callLogId: string,
): Promise<SyncResult> => {
  const res = (await client.query({
    callLogs: {
      __args: { filter: { id: { eq: callLogId } }, first: 1 },
      edges: {
        node: {
          recording: { primaryLinkUrl: true },
          transcript: { markdown: true, blocknote: true },
          aiTranscript: { markdown: true, blocknote: true },
        },
      },
    },
  })) as {
    callLogs?: { edges?: Array<{ node: CallLogTranscripts }> };
  };

  const node = res.callLogs?.edges?.[0]?.node;
  if (!node) return { skipped: 'not-found' };

  const url = node.recording?.primaryLinkUrl ?? '';
  if (!url) return { skipped: 'no-recording' };

  const field: 'aiTranscript' | 'transcript' | null = hasTranscriptText(
    node.aiTranscript ?? {},
  )
    ? 'aiTranscript'
    : hasTranscriptText(node.transcript ?? {})
      ? 'transcript'
      : null;
  if (!field) return { skipped: 'no-transcript' };

  const name = fileNameFromUrl(url);
  const updated = attachAudioToRichText(node[field], url, name);

  await client.mutation({
    updateCallLog: {
      __args: { id: callLogId, data: { [field]: updated } },
      id: true,
    },
  });

  return { updated: field };
};
