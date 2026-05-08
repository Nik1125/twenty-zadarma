import { localToUtcIso } from 'src/modules/zadarma/utils/local-to-utc-iso';

// Pure parser shared by the live-sync logic-function and (future) any TS-port
// of the CLI transformer. Mirrors the grouping + normalization rules of
// `scripts/transformers/zadarma-calls-csv.mjs` so the same input produces the
// same canonical CallLog row whichever ingestion path runs.
//
// Input shape matches `/v1/statistics/pbx/?version=2` JSON `stats[]` rows.
// Output shape matches the `createCallLog` mutation's `data` argument keys
// (subset — caller fills extras like `name`).

export type ZadarmaPbxStatRow = {
  call_id?: string;
  pbx_call_id?: string;
  sip?: string | number;
  callstart?: string;
  clid?: string;
  destination?: string | number;
  disposition?: string;
  seconds?: string | number;
  is_recorded?: string | boolean;
};

export type CanonicalCallLogRow = {
  pbxCallId: string;
  callType: 'IN' | 'OUT';
  callStart: string | null;
  duration: number;
  disposition: Disposition | null;
  clientNumber: string;
  ourNumber: string;
  internalExtension: string | null;
  name: string;
};

export type Disposition =
  | 'ANSWERED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'CANCEL'
  | 'CALL_FAILED';

const DISPOSITION_MAP: Record<string, Disposition> = {
  answered: 'ANSWERED',
  'no answer': 'NO_ANSWER',
  busy: 'BUSY',
  cancel: 'CANCEL',
  failed: 'CALL_FAILED',
  'call failed': 'CALL_FAILED',
};

export const e164NoPlus = (raw: string | number | undefined | null): string => {
  if (raw === undefined || raw === null) return '';
  return String(raw).replace(/\D+/g, '');
};

// `clid` formats:
//   "Algeness (48539923725)"      ← inbound, real number in parens
//   "Paulina 101 (101)"           ← outbound, SIP extension in parens (useless)
//   "\"Caller\" <+48515637746>"   ← inbound, number in angle brackets
//   "48539923725"                 ← bare E.164
// For inbound calls only the first form (with a number ≥7 digits) is useful;
// for outbound we don't use clid at all (caller fills `destination` instead).
export const extractClientFromClid = (clid: string | undefined): string => {
  if (!clid) return '';
  const angle = clid.match(/<\+?(\d+)>/);
  if (angle) return angle[1];
  const parens = clid.match(/\((\d+)\)/);
  if (parens) return parens[1];
  return e164NoPlus(clid);
};

const mapDisposition = (raw: string | undefined): Disposition | null => {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  return DISPOSITION_MAP[v] ?? null;
};

const sumSeconds = (rows: ZadarmaPbxStatRow[]): number => {
  let total = 0;
  for (const r of rows) {
    const n = typeof r.seconds === 'number' ? r.seconds : Number(r.seconds);
    if (Number.isFinite(n)) total += n;
  }
  return total;
};

const directionFromPbxCallId = (pbxCallId: string): 'IN' | 'OUT' =>
  pbxCallId.startsWith('out_') ? 'OUT' : 'IN';

export type GroupAndNormalizeOpts = {
  ourNumber: string;
  cabinetTimezone: string;
};

// Group multi-leg legs (same `pbx_call_id`, different Asterisk `call_id`) into
// a single canonical row. Skips rows with no `pbx_call_id` (cannot dedup
// against webhook stream without it). `cabinetTimezone` empty → callStart null
// (matches webhook handler's null-safe behavior; consumer must set tz to get
// timestamps).
export const groupAndNormalizeStats = (
  stats: ZadarmaPbxStatRow[],
  opts: GroupAndNormalizeOpts,
): { rows: CanonicalCallLogRow[]; skipped: number } => {
  const byPbxCallId = new Map<string, ZadarmaPbxStatRow[]>();
  let skipped = 0;
  for (const row of stats) {
    const pbxCallId = (row.pbx_call_id ?? '').trim();
    if (!pbxCallId) {
      skipped++;
      continue;
    }
    const list = byPbxCallId.get(pbxCallId);
    if (list) list.push(row);
    else byPbxCallId.set(pbxCallId, [row]);
  }

  const rows: CanonicalCallLogRow[] = [];
  for (const [pbxCallId, legs] of byPbxCallId) {
    // Root = leg with non-empty `call_id` (Asterisk channel id), else first.
    const root = legs.find((r) => (r.call_id ?? '').trim() !== '') ?? legs[0];
    const callType = directionFromPbxCallId(pbxCallId);
    const totalSeconds = sumSeconds(legs);

    let clientNumber = '';
    let ourNumber = '';
    if (callType === 'IN') {
      clientNumber = extractClientFromClid(root.clid);
      ourNumber = e164NoPlus(root.destination);
    } else {
      clientNumber = e164NoPlus(root.destination);
      ourNumber = opts.ourNumber;
    }

    const internalExtension = (() => {
      const v = String(root.sip ?? '').trim();
      if (!v || v === '0') return null;
      return v;
    })();

    const callStart = opts.cabinetTimezone
      ? localToUtcIso(root.callstart, opts.cabinetTimezone)
      : null;
    const startedHM = root.callstart ? root.callstart.slice(0, 16) : '';
    const name = `${callType} ${clientNumber || '?'}${startedHM ? ` — ${startedHM}` : ''}`;

    rows.push({
      pbxCallId,
      callType,
      callStart,
      duration: totalSeconds,
      disposition: mapDisposition(root.disposition),
      clientNumber,
      ourNumber,
      internalExtension,
      name,
    });
  }

  rows.sort((a, b) => a.pbxCallId.localeCompare(b.pbxCallId));
  return { rows, skipped };
};
