// Zadarma "Statistics → PBX users" CSV → canonical callLog CSV.
//
// Usage:
//   node scripts/transformers/zadarma-calls-csv.mjs <input.csv> <output.csv> [--our-number 48573580808] [--tz Europe/Warsaw]
//
// Defaults: tz = Europe/Warsaw. --our-number is the corporate Zadarma DID
// used as `ourNumber` for outbound rows (the CSV doesn't expose the public
// caller-id used by the PBX — fill it from your own knowledge).
//
// Source schema (semicolon-delimited):
//   id;call_type;internal_number;date;clid;destination;disposition;seconds;call_id
// Multi-leg calls share a `call_id` across rows; the root row has `id` set.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  parseDelimited,
  writeCsv,
  localToUtcIso,
  e164NoPlus,
  requireArg,
} from './_lib.mjs';

const USAGE = `Usage: node scripts/transformers/zadarma-calls-csv.mjs <input.csv> <output.csv> [--our-number 48573580808] [--tz Europe/Warsaw]`;

const DISPOSITION_MAP = {
  answered: 'ANSWERED',
  'no answer': 'NO_ANSWER',
  busy: 'BUSY',
  cancel: 'CANCEL',
  failed: 'CALL_FAILED',
  'call failed': 'CALL_FAILED',
};

const CANONICAL_HEADER = [
  'pbxCallId',
  'callType',
  'callStart',
  'duration',
  'disposition',
  'clientNumber',
  'ourNumber',
  'internalExtension',
  'name',
];

const parseArgs = (argv) => {
  const positional = [];
  const flags = { ourNumber: '', tz: 'Europe/Warsaw' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--our-number') {
      flags.ourNumber = e164NoPlus(argv[++i]);
    } else if (a === '--tz') {
      flags.tz = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
};

const extractClientFromClid = (clid) => {
  // clid examples:
  //   "Algeness (48539923725)"  ← inbound: number in parens
  //   "Paulina 101 (101)"        ← outbound: extension in parens, useless for client
  //   "48539923725"              ← bare E.164
  if (!clid) return '';
  const parens = clid.match(/\((\d+)\)/);
  if (parens) return e164NoPlus(parens[1]);
  return e164NoPlus(clid);
};

const main = () => {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const input = requireArg(positional, 0, USAGE);
  const output = requireArg(positional, 1, USAGE);

  const text = readFileSync(input, 'utf-8');
  const sourceRows = parseDelimited(text, ';');

  // Group by call_id so multi-leg calls collapse into one record.
  const byCallId = new Map();
  for (const row of sourceRows) {
    const callId = row.call_id?.trim();
    if (!callId) continue;
    const existing = byCallId.get(callId);
    if (!existing) {
      byCallId.set(callId, [row]);
    } else {
      existing.push(row);
    }
  }

  const canonical = [];
  let skippedNoRoot = 0;
  for (const [callId, rows] of byCallId) {
    // Root row is the one with a non-empty `id`. Fall back to first row.
    const root = rows.find((r) => r.id && r.id.trim() !== '') ?? rows[0];
    if (!root) {
      skippedNoRoot++;
      continue;
    }

    const callType = (root.call_type || '').toLowerCase() === 'out' ? 'OUT' : 'IN';
    const dispoRaw = (root.disposition || '').toLowerCase().trim();
    const disposition = DISPOSITION_MAP[dispoRaw] ?? '';

    const totalSeconds = rows.reduce((acc, r) => {
      const n = Number(r.seconds);
      return Number.isFinite(n) ? acc + n : acc;
    }, 0);

    let clientNumber = '';
    let ourNumber = '';
    if (callType === 'IN') {
      clientNumber = extractClientFromClid(root.clid);
      ourNumber = e164NoPlus(root.destination);
    } else {
      clientNumber = e164NoPlus(root.destination);
      ourNumber = flags.ourNumber;
    }

    const internalExtension = (() => {
      const v = (root.internal_number || '').trim();
      if (!v || v === '0') return '';
      return v;
    })();

    const callStart = root.date ? localToUtcIso(root.date, flags.tz) : '';
    const startedHM = root.date ? root.date.slice(0, 16) : '';
    const name = `${callType} ${clientNumber || '?'}${startedHM ? ` — ${startedHM}` : ''}`;

    canonical.push({
      pbxCallId: callId,
      callType,
      callStart,
      duration: String(totalSeconds || ''),
      disposition,
      clientNumber,
      ourNumber,
      internalExtension,
      name,
    });
  }

  // Stable sort by pbxCallId — makes idempotency byte-equal across runs.
  canonical.sort((a, b) => a.pbxCallId.localeCompare(b.pbxCallId));

  const csv = writeCsv(CANONICAL_HEADER, canonical);
  writeFileSync(output, csv);

  const inCount = canonical.filter((r) => r.callType === 'IN').length;
  const outCount = canonical.filter((r) => r.callType === 'OUT').length;
  console.log(
    `[zadarma-calls-csv] source rows=${sourceRows.length} grouped calls=${canonical.length} (in=${inCount} out=${outCount}) skipped=${skippedNoRoot}`,
  );
  console.log(`[zadarma-calls-csv] wrote ${output}`);
};

main();
