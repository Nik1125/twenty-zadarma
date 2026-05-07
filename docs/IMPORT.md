# Importing historical data

Migrate calls and SMS from any source platform into Twenty using the same three-step flow. The App's transformers turn vendor-specific exports into a canonical CSV that Twenty's built-in **Settings → Data → Import** can ingest without manual column mapping.

```
[Source export]
   ↓ scripts/transformers/<source>.mjs   (vendor format → canonical CSV)
[Canonical CSV]
   ↓ Twenty UI: Settings → Data → Import → upload CSV
[callLog / smsLog records in Twenty]
   ↓ Settings → Zadarma → Re-link orphans  (auto-attaches to Persons by phone)
[Linked records, ready to use]
```

## Canonical CSV schemas

Column names match each object's field `name` exactly so Twenty Import auto-maps them.

### `callLog`

```csv
pbxCallId,callType,callStart,duration,disposition,clientNumber,ourNumber,internalExtension,name
```

| Column              | Type      | Required | Notes                                                                                          |
|---------------------|-----------|----------|------------------------------------------------------------------------------------------------|
| `pbxCallId`         | string    | yes      | **Dedup key.** Source platform's stable call id (Zadarma `pbx_call_id` / `call_id`).           |
| `callType`          | enum      | yes      | `IN` or `OUT`.                                                                                 |
| `callStart`         | ISO 8601  | yes      | UTC, milliseconds, e.g. `2026-04-28T06:21:16.000Z`.                                            |
| `duration`          | integer   |          | Seconds. Empty for missed/unanswered.                                                          |
| `disposition`       | enum      |          | `ANSWERED` / `NO_ANSWER` / `BUSY` / `CANCEL` / `CALL_FAILED`.                                  |
| `clientNumber`      | string    | yes\*    | E.164 without `+`. Used by **Re-link orphans** to attach to a Person.                          |
| `ourNumber`         | string    |          | Corporate Zadarma DID, E.164 without `+`. Outbound rows in Zadarma's CSV don't expose this — pass it via `--our-number`. |
| `internalExtension` | string    |          | PBX extension that handled the call (e.g. `101`). Empty if none.                               |
| `name`              | string    | yes      | Display label, e.g. `IN 48539923725 — 2026-04-28 08:21`.                                       |

\* Required to allow auto-link to Person; rows missing it import successfully but stay orphan.

Optional fields (`recording.*`, `transcript`, `summary`, `cost.*`, `callPath`) are accepted by Twenty Import if you add the columns; the bundled transformers leave them empty for one-shot historical migrations.

### `smsLog`

```csv
messageId,direction,status,errorMessage,sentAt,clientNumber,ourNumber,body,cost.amountMicros,cost.currencyCode,name
```

| Column              | Type      | Required | Notes                                                                                          |
|---------------------|-----------|----------|------------------------------------------------------------------------------------------------|
| `messageId`         | string    | yes      | **Dedup key.** Source platform's stable message id.                                            |
| `direction`         | enum      | yes      | `IN` or `OUT`.                                                                                 |
| `status`            | enum      | yes      | `SUCCESS` / `PENDING` / `FAILED`.                                                              |
| `errorMessage`      | string    |          | Provider error string. Empty when `status = SUCCESS`.                                          |
| `sentAt`            | ISO 8601  | yes      | UTC, milliseconds.                                                                             |
| `clientNumber`      | string    | yes\*    | E.164 without `+`. Used by **Re-link orphans**.                                                |
| `ourNumber`         | string    | yes      | Corporate Zadarma DID, E.164 without `+`.                                                      |
| `body`              | string    | yes      | Full SMS text. Multi-line supported (CSV handles quoting).                                     |
| `cost.amountMicros` | integer   |          | `cost * 1_000_000`, rounded. Empty if unknown.                                                 |
| `cost.currencyCode` | string    |          | ISO 4217, e.g. `PLN`, `USD`, `EUR`.                                                            |
| `name`              | string    | yes      | Display label, e.g. `OUT 48792010388 — 2026-05-03 13:59`.                                      |

\* Required for Re-link to find a match; rows without it import as orphans.

## Step-by-step: Zadarma calls

1. **Export** in Zadarma cabinet: `Statistics → PBX users → CSV download` for your migration window. Save as e.g. `zadarma-calls.csv`.
2. **Transform**:
   ```bash
   node scripts/transformers/zadarma-calls-csv.mjs \
     zadarma-calls.csv \
     zadarma-calls-canonical.csv \
     --our-number 48573580808 \
     --tz Europe/Warsaw
   ```
   The `--our-number` flag fills `ourNumber` for **outbound** rows (Zadarma's CSV doesn't expose the public caller-id). Use the DID printed by **Settings → Zadarma → Direct numbers**.
3. **Import** in Twenty: `Settings → Data → Call logs → Import → CSV` → upload `zadarma-calls-canonical.csv`. Confirm column mapping (auto-mapped) → Run.
4. **Re-link orphans**: `Settings → Zadarma → Re-link orphans`. Counter for "Calls without Person" should drop by however many imported calls match an existing Person's phone.

## Step-by-step: Zadarma SMS

Zadarma's public API does **not** expose SMS history — only the cabinet UI does. The bundled browser-console script paginates through the cabinet's internal endpoint and downloads a JSON file.

1. **Export** by running `scripts/transformers/zadarma-sms-history-parser.js` in your browser DevTools console on `https://my.zadarma.com/sms/history/`. Edit the `FROM` / `TO` constants at the top of the script first. Output: `zadarma_sms_<TODAY>.json`.

   See the `zadarma-sms-history-export` skill (`.claude/skills/zadarma-sms-history-export/`) for the full procedure plus common foot-guns.
2. **Transform**:
   ```bash
   node scripts/transformers/zadarma-sms-json.mjs \
     zadarma_sms_2026-05-07.json \
     zadarma-sms-canonical.csv \
     --tz Europe/Warsaw
   ```
3. **Import** in Twenty: `Settings → Data → SMS logs → Import → CSV` → upload → Run.
4. **Re-link orphans**: same button as above. SMS counter drops.

## Dedup behaviour

Twenty Import refuses to create a row whose `pbxCallId` (or `messageId`) already exists, because both fields are marked `isUnique: true` in the object schema. Re-running an import on the same canonical CSV imports zero new rows; it does not duplicate.

This means **transformers can be re-run** safely after pulling a fresh export. Only newly added rows since the last import will land.

## Timezones

- All bundled transformers assume the source export's wall-clock is `Europe/Warsaw` by default — Zadarma's typical Polish-account display tz.
- Override with `--tz <IANA-tz-name>` (e.g. `--tz America/New_York`).
- The transformer converts to UTC before writing the CSV. Twenty stores UTC and renders in the viewer's local tz.

## Adding a transformer for a new source

See `scripts/transformers/README.md` for the adapter contract — input format, idempotency, column names, enum values, phone format, datetime format, and how to test.

## Troubleshooting

- **"Cannot read properties of undefined (reading 'map')"** when clicking Import — fixed in v0.4.0; if it returns, uninstall + reinstall the App on a Postgres backup, then retry.
- **Counts don't drop after Re-link** — open a few imported records and confirm `clientNumber` is populated (E.164 no `+`, ≥9 digits) and Person.phones has at least one matching phone. The match rule is "last 9 digits suffix".
- **`429 Too Many Requests`** in the SMS browser parser — bump `DELAY_MS` from 250 → 500 → 1000.
- **Outbound calls have empty `ourNumber`** — pass `--our-number <your-DID>` to `zadarma-calls-csv.mjs`.
