# Transformers

Source-format → canonical-CSV converters. Each one reads a vendor-specific export and writes a CSV whose columns match `callLog` / `smsLog` field names 1-to-1 so Twenty's built-in **Settings → Data → Import** can ingest it without manual column mapping.

The full migration playbook lives in [`docs/IMPORT.md`](../../docs/IMPORT.md). This README is the contract for adding a new transformer.

## Adapter contract

Every transformer is a single `.mjs` file in this folder. It must:

1. **Be a CLI**:
   ```bash
   node scripts/transformers/<name>.mjs <input> <output> [--flag value]
   ```
   Print usage to stderr and `process.exit(1)` if positional args are missing.

2. **Be pure**: read `<input>`, write `<output>`. No network calls, no env-var reads, no I/O outside the two paths and stdout/stderr.

3. **Be idempotent**: running twice over the same input must produce byte-identical output. Sort the output by the dedup key (`pbxCallId` for callLog, `messageId` for smsLog) before writing to make this true regardless of source row order.

4. **Emit canonical column names** matching the target object's field `name` exactly:

   **callLog canonical CSV header**:
   ```
   pbxCallId,callType,callStart,duration,disposition,clientNumber,ourNumber,internalExtension,name
   ```

   **smsLog canonical CSV header**:
   ```
   messageId,direction,status,errorMessage,sentAt,clientNumber,ourNumber,body,cost.amountMicros,cost.currencyCode,name
   ```

   Composite types use dot notation (`cost.amountMicros`, `recording.primaryLinkUrl`). Twenty Import understands them.

5. **Output values matching object SELECT enums verbatim** — e.g. `IN`/`OUT`, `ANSWERED`/`NO_ANSWER`/`BUSY`/`CANCEL`/`CALL_FAILED`, `SUCCESS`/`PENDING`/`FAILED`. See `src/objects/call-log.object.ts` and `src/objects/sms-log.object.ts` for the canonical lists.

6. **Phone numbers**: E.164 without `+` (e.g. `48539923725`). Helper: `e164NoPlus(raw)` in `_lib.mjs`.

7. **Datetimes**: ISO 8601 UTC with millisecond precision (`2026-04-28T06:21:16.000Z`). If the source emits wall-clock-in-local-tz (most do), convert via `localToUtcIso(local, tz)` from `_lib.mjs`. Default tz: `Europe/Warsaw`. Accept a `--tz` override flag.

8. **No new runtime deps**. Use Node built-ins + helpers in `_lib.mjs`. If you genuinely need a library, raise an issue first — keeping these scripts dep-free means anyone with Node 24+ can run them without `yarn install`.

9. **Document non-obvious mapping decisions inline** with `// Why:` comments — especially anything where the source doesn't map cleanly (e.g. the multi-leg call grouping in `zadarma-calls-csv.mjs`).

## Existing transformers

| File                                  | Source                                                 | Target object  |
|---------------------------------------|--------------------------------------------------------|----------------|
| `zadarma-calls-csv.mjs`               | Zadarma `Statistics → PBX users` CSV (`;`-delimited)   | `callLog`      |
| `zadarma-sms-json.mjs`                | Zadarma SMS history JSON (from the browser parser below) | `smsLog`     |
| `zadarma-sms-history-parser.js`       | Zadarma cabinet `/sms/history/get` endpoint            | (raw JSON dump) |

The browser parser is its own thing — runs in the user's DevTools console because Zadarma's public API has no SMS-history endpoint. Output feeds `zadarma-sms-json.mjs`.

## Testing a new transformer

```bash
# Tiny smoke test — first 5 rows
head -5 my_input.csv > /tmp/smoke.csv
node scripts/transformers/<name>.mjs /tmp/smoke.csv /tmp/out.csv
cat /tmp/out.csv | head

# Idempotency check
node scripts/transformers/<name>.mjs my_input.csv /tmp/out1.csv
node scripts/transformers/<name>.mjs my_input.csv /tmp/out2.csv
diff /tmp/out1.csv /tmp/out2.csv  # must be empty
```

After importing the canonical CSV via Twenty UI, click **Settings → Zadarma → Re-link orphans** to attach imported records to existing Persons by phone.
