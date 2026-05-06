import { randomUUID } from 'node:crypto';

// One merged speaker turn produced by the SPEECH_RECOGNITION parser.
export type DialogTurn = {
  channel: number | null;
  text: string;
};

export type FormatTranscriptArgs = {
  turns: DialogTurn[];
  pbxCallId: string;
  recordingUrl?: string | null;
  recordingFileName?: string | null;
};

export type FormatTranscriptResult = {
  markdown: string;
  blocknote: string;
};

const operatorChannelFor = (pbxCallId: string): number =>
  pbxCallId.startsWith('out_') ? 1 : 2;

// Build a BlockNote document: one paragraph per speaker turn (with bold
// Operator/Client label prefix). Audio embed was removed — Zadarma serves
// recordings as OGG which BlockNote/Notion-style editors don't reliably play
// (and Zadarma's signed URLs expire in hours, not the documented "month"),
// so we keep the recording reference only in the callLog.recording (LINKS)
// field. Listening still possible via Zadarma TeamSale UI.
const buildBlocknote = (
  turns: DialogTurn[],
  pbxCallId: string,
): unknown[] => {
  const operatorChannel = operatorChannelFor(pbxCallId);
  const isStereo =
    new Set(turns.map((t) => t.channel).filter((c): c is number => c !== null))
      .size >= 2;

  return turns.map((t) => {
    const content: Array<{ type: 'text'; text: string; styles: { bold?: true } }> = [];
    if (isStereo && t.channel !== null) {
      const label = t.channel === operatorChannel ? 'Operator: ' : 'Client: ';
      content.push({ type: 'text', text: label, styles: { bold: true } });
    }
    content.push({ type: 'text', text: t.text, styles: {} });

    return {
      id: randomUUID(),
      type: 'paragraph',
      props: {
        textColor: 'default',
        backgroundColor: 'default',
        textAlignment: 'left',
      },
      content,
      children: [],
    };
  });
};

const buildMarkdown = (turns: DialogTurn[], pbxCallId: string): string => {
  const operatorChannel = operatorChannelFor(pbxCallId);
  const isStereo =
    new Set(turns.map((t) => t.channel).filter((c): c is number => c !== null))
      .size >= 2;

  if (!isStereo) {
    return turns.map((t) => t.text).join('\n\n');
  }
  return turns
    .map((t) => {
      const label =
        t.channel === operatorChannel ? '**Operator:**' : '**Client:**';
      return `${label} ${t.text}`;
    })
    .join('\n\n');
};

export const formatTranscript = ({
  turns,
  pbxCallId,
}: FormatTranscriptArgs): FormatTranscriptResult => {
  return {
    markdown: buildMarkdown(turns, pbxCallId),
    blocknote: JSON.stringify(buildBlocknote(turns, pbxCallId)),
  };
};
