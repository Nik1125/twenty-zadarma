// Zadarma SMS history JSON export → canonical smsLog CSV.
//
// Usage:
//   node scripts/transformers/zadarma-sms-json.mjs <input.json> <output.csv> [--our-number 48573580808] [--tz Europe/Warsaw]
//
// Defaults: tz = Europe/Warsaw (the timezone Zadarma's cabinet displays
// timestamps in).
//
// --our-number is a fallback for outbound rows where Zadarma populates
// `sender` with an alphanumeric brand string (e.g. "zadarma.com") instead
// of the actual DID. When the row's sender parses to digits, we keep it;
// otherwise we substitute --our-number. Inbound rows ignore the flag
// (sender there is always the client's E.164 phone).
//
// Source format: array of objects with keys
//   id, sender, phonenumber, message, cost_per_one_part, cost, currency, parts,
//   date ("YYYY-MM-DD HH:mm:ss"), error, status ("success" | other), direction ("in" | "out")
//
// Generate the input JSON by running scripts/transformers/zadarma-sms-history-parser.js
// in the browser console on https://my.zadarma.com/sms/history/ — it downloads
// `zadarma_sms_<DATE>.json` ready for this script.

import { readFileSync, writeFileSync } from 'node:fs';
import { writeCsv, localToUtcIso, e164NoPlus, requireArg } from './_lib.mjs';

const USAGE = `Usage: node scripts/transformers/zadarma-sms-json.mjs <input.json> <output.csv> [--our-number 48573580808] [--tz Europe/Warsaw]`;

const CANONICAL_HEADER = [
  'messageId',
  'direction',
  'status',
  'errorMessage',
  'sentAt',
  'clientNumber',
  'ourNumber',
  'body',
  'cost.amountMicros',
  'cost.currencyCode',
  'name',
];

const parseArgs = (argv) => {
  const positional = [];
  const flags = { tz: 'Europe/Warsaw', ourNumber: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tz') {
      flags.tz = argv[++i];
    } else if (a === '--our-number') {
      flags.ourNumber = e164NoPlus(argv[++i]);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
};

const main = () => {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const input = requireArg(positional, 0, USAGE);
  const output = requireArg(positional, 1, USAGE);

  const raw = readFileSync(input, 'utf-8');
  const source = JSON.parse(raw);
  if (!Array.isArray(source)) {
    console.error(`Expected JSON array at top level of ${input}, got ${typeof source}`);
    process.exit(1);
  }

  const canonical = [];
  let skippedNoId = 0;
  for (const row of source) {
    if (!row?.id) {
      skippedNoId++;
      continue;
    }

    const direction = String(row.direction).toLowerCase() === 'in' ? 'IN' : 'OUT';
    // Zadarma SMS export reports "success" for delivered (or accepted) messages,
    // empty/other for failures. The platform doesn't expose a "pending" state
    // in this export, so we map binary success/failed.
    const status = String(row.status).toLowerCase() === 'success' ? 'SUCCESS' : 'FAILED';
    const errorMessage = status === 'FAILED' ? (row.error ?? '') : '';

    // Sender / phonenumber roles flip with direction:
    //   OUT: sender = our DID (or an alphanumeric brand like "zadarma.com"),
    //        phonenumber = client
    //   IN:  sender = client, phonenumber = our DID
    // Initially we mapped both directions the same way and inbound rows landed
    // with the swap. Then we found `sender` is sometimes a brand string for
    // OUT rows — e164NoPlus strips it to ''. Falls back to --our-number flag
    // so outbound ourNumber is consistent.
    const clientNumber =
      direction === 'IN' ? e164NoPlus(row.sender) : e164NoPlus(row.phonenumber);
    const parsedSender = e164NoPlus(row.sender);
    const ourNumber =
      direction === 'IN'
        ? e164NoPlus(row.phonenumber)
        : parsedSender || flags.ourNumber;
    const sentAt = row.date ? localToUtcIso(row.date, flags.tz) : '';

    // Currency: Twenty's CURRENCY composite stores `amountMicros` (integer).
    // Zadarma's `cost` is a float; round to nearest micro to absorb the
    // floating-point garbage we saw in raw exports (e.g. 0.8999999999999999).
    const costNum = Number(row.cost);
    const amountMicros = Number.isFinite(costNum) ? Math.round(costNum * 1_000_000) : '';
    const currencyCode = row.currency ?? '';

    const sentHM = row.date ? String(row.date).slice(0, 16) : '';
    const name = `${direction} ${clientNumber || '?'}${sentHM ? ` — ${sentHM}` : ''}`;

    canonical.push({
      messageId: String(row.id),
      direction,
      status,
      errorMessage,
      sentAt,
      clientNumber,
      ourNumber,
      body: row.message ?? '',
      'cost.amountMicros': String(amountMicros),
      'cost.currencyCode': currencyCode,
      name,
    });
  }

  // Stable sort by messageId — idempotent output regardless of source order.
  canonical.sort((a, b) => a.messageId.localeCompare(b.messageId));

  const csv = writeCsv(CANONICAL_HEADER, canonical);
  writeFileSync(output, csv);

  const inCount = canonical.filter((r) => r.direction === 'IN').length;
  const outCount = canonical.filter((r) => r.direction === 'OUT').length;
  console.log(
    `[zadarma-sms-json] source rows=${source.length} mapped=${canonical.length} (in=${inCount} out=${outCount}) skipped=${skippedNoId}`,
  );
  console.log(`[zadarma-sms-json] wrote ${output}`);
};

main();
