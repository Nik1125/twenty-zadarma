import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { buildEnrichmentCurl } from 'src/front-components/utils/build-enrichment-curl';
import { buildSendSmsCurl } from 'src/front-components/utils/build-send-sms-curl';
import { copyToClipboard } from 'src/front-components/utils/copy-to-clipboard';

export const ZADARMA_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER =
  '71c274e8-f9af-4835-9442-6a9a1a17a87b';

type ZadarmaInfo = {
  ok: boolean;
  error?: string;
  balance?: number;
  currency?: string;
  tariff?: string;
  numbers?: Array<{ number?: string; description?: string; country?: string; status?: string }>;
};

type WebhookCheck = {
  status: 'idle' | 'pending' | 'ok' | 'fail';
  detail?: string;
};

type AppVar = { key: string; value: string };

// Common IANA timezones for Zadarma cabinet locations. Datalist suggestions
// only — users can also type any other valid IANA name.
const COMMON_IANA_TIMEZONES = [
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Prague',
  'Europe/Paris',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Baku',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
];

const ZadarmaSettings = () => {
  const apiBaseUrl = useMemo(
    () => (process.env.TWENTY_API_URL ?? '').replace(/\/$/, ''),
    [],
  );
  const accessToken = process.env.TWENTY_APP_ACCESS_TOKEN;

  const pbxWebhookUrl = `${apiBaseUrl}/s/zadarma/pbx-webhook`;
  const eventWebhookUrl = `${apiBaseUrl}/s/zadarma-event-webhook`;
  const enrichmentEndpointUrl = `${apiBaseUrl}/s/zadarma/call-enrichment`;
  const sendSmsWebhookUrl = `${apiBaseUrl}/s/zadarma/send-sms`;
  const enrichmentDocsUrl =
    'https://github.com/Nik1125/twenty-zadarma/blob/main/docs/AI_ENRICHMENT.md';

  const [info, setInfo] = useState<ZadarmaInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [pbxCheck, setPbxCheck] = useState<WebhookCheck>({ status: 'idle' });
  const [eventCheck, setEventCheck] = useState<WebhookCheck>({ status: 'idle' });
  const [enrichCheck, setEnrichCheck] = useState<WebhookCheck>({ status: 'idle' });

  const [appId, setAppId] = useState<string | null>(null);
  // CSV string of E.164-without-plus DIDs; first entry is the default.
  // Operators normally toggle this through the checkbox widget below;
  // the free-text fallback shows up only when info.numbers is empty.
  const [zadarmaDids, setZadarmaDids] = useState<string>('');
  const [transcriptEnabled, setTranscriptEnabled] = useState<boolean>(true);
  const [cabinetTimezone, setCabinetTimezone] = useState<string>('');
  const [tzCustomMode, setTzCustomMode] = useState<boolean>(false);
  const [savingVar, setSavingVar] = useState<string | null>(null);

  const tzValid = useMemo<boolean | null>(() => {
    if (!cabinetTimezone) return null;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: cabinetTimezone });
      return true;
    } catch {
      return false;
    }
  }, [cabinetTimezone]);

  const [orphanCounts, setOrphanCounts] = useState<{ calls: number; sms: number } | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanResult, setRescanResult] = useState<string | null>(null);

  const [lastContactedCounts, setLastContactedCounts] = useState<{
    total: number;
    withTimestamp: number;
    withoutTimestamp: number;
  } | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<string | null>(null);

  // Sync calls from Zadarma — incremental by default, custom range capped at 1 year.
  type SyncMode = 'incremental' | 'custom';
  const [syncMode, setSyncMode] = useState<SyncMode>('incremental');
  const [syncFromLocal, setSyncFromLocal] = useState('');
  const [syncToLocal, setSyncToLocal] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);

  // Enrich existing callLogs with recordings + transcripts (back-fill).
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [enrichStartedAt, setEnrichStartedAt] = useState<number | null>(null);

  // Per-minute outbound rates for cost computation.
  const [zadarmaRatePerMinute, setZadarmaRatePerMinute] = useState<string>('');
  const [zadarmaRateCurrency, setZadarmaRateCurrency] = useState<string>('');
  const [aiRatePerMinute, setAiRatePerMinute] = useState<string>('');
  const [aiRateCurrency, setAiRateCurrency] = useState<string>('');

  // Recompute all callLog.cost values (back-fill / on-rate-change re-fill).
  const [recomputingCosts, setRecomputingCosts] = useState(false);
  const [recomputeCostsResult, setRecomputeCostsResult] = useState<string | null>(null);
  const [recomputeCostsStartedAt, setRecomputeCostsStartedAt] = useState<number | null>(null);

  // TeamSale (Zadarma free CRM) backup link state.
  const [teamsaleBaseUrl, setTeamsaleBaseUrl] = useState<string>('');
  const [autoCreatePerson, setAutoCreatePerson] = useState<boolean>(false);
  const [teamsaleSyncing, setTeamsaleSyncing] = useState(false);
  const [teamsaleSyncResult, setTeamsaleSyncResult] = useState<string | null>(null);
  const [teamsaleSyncStartedAt, setTeamsaleSyncStartedAt] = useState<number | null>(null);

  // Tick state forces a re-render every second while a long-running button
  // is in flight, so the label can show elapsed seconds. Without this the UI
  // looks frozen for ~minutes on long syncs / back-fills, and the user can't
  // tell whether the call is alive or hung.
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!syncing && !enriching && !recomputingCosts && !teamsaleSyncing) return;
    const id = setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [syncing, enriching, recomputingCosts, teamsaleSyncing]);

  const elapsedLabel = (startedAt: number | null): string => {
    if (startedAt === null) return '';
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  // datetime-local values are interpreted in the browser's local timezone, then
  // converted to UTC ISO. For users whose browser TZ matches the cabinet TZ
  // this matches what they see in the Zadarma cabinet. The 1h overlap default
  // (server side) protects against minor drift; if the count looks off, run
  // again with adjusted bounds.
  const customRangeDays = useMemo(() => {
    if (!syncFromLocal || !syncToLocal) return null;
    const fromMs = Date.parse(syncFromLocal);
    const toMs = Date.parse(syncToLocal);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return null;
    }
    return (toMs - fromMs) / (24 * 60 * 60 * 1000);
  }, [syncFromLocal, syncToLocal]);
  const customRangeInvalid =
    syncMode === 'custom' &&
    (customRangeDays === null || customRangeDays > 365);

  const refreshInfo = async () => {
    if (!apiBaseUrl || !accessToken) return;
    setInfoLoading(true);
    try {
      const r = await fetch(`${apiBaseUrl}/s/zadarma/info`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await r.json()) as ZadarmaInfo;
      setInfo(json);
    } catch (e) {
      setInfo({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setInfoLoading(false);
    }
  };

  const fetchAppVars = async () => {
    if (!apiBaseUrl || !accessToken) return;
    try {
      const r = await fetch(`${apiBaseUrl}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          query: `query { findOneApplication(universalIdentifier: "${APPLICATION_UNIVERSAL_IDENTIFIER}") { id applicationVariables { key value } } }`,
        }),
      });
      const json = (await r.json()) as {
        data?: { findOneApplication?: { id?: string; applicationVariables?: AppVar[] } };
      };
      const app = json.data?.findOneApplication;
      if (app?.id) setAppId(app.id);
      const vars = app?.applicationVariables ?? [];
      const dids = vars.find((v) => v.key === 'ZADARMA_DIDS')?.value ?? '';
      const tr = (vars.find((v) => v.key === 'ZADARMA_TRANSCRIPT_ENABLED')?.value ?? 'true').toLowerCase();
      const tz = vars.find((v) => v.key === 'ZADARMA_CABINET_TIMEZONE')?.value ?? '';
      const zRate = vars.find((v) => v.key === 'ZADARMA_RATE_PER_MINUTE')?.value ?? '';
      const zCur = vars.find((v) => v.key === 'ZADARMA_RATE_CURRENCY')?.value ?? '';
      const aRate = vars.find((v) => v.key === 'AI_RATE_PER_MINUTE')?.value ?? '';
      const aCur = vars.find((v) => v.key === 'AI_RATE_CURRENCY')?.value ?? '';
      const tsUrl = vars.find((v) => v.key === 'TEAMSALE_BASE_URL')?.value ?? '';
      const acpRaw = (vars.find((v) => v.key === 'ZADARMA_AUTO_CREATE_PERSON')?.value ?? 'false').toLowerCase();
      setZadarmaDids(dids);
      setTranscriptEnabled(tr !== 'false' && tr !== '0');
      setCabinetTimezone(tz);
      setZadarmaRatePerMinute(zRate);
      setZadarmaRateCurrency(zCur);
      setAiRatePerMinute(aRate);
      setAiRateCurrency(aCur);
      setTeamsaleBaseUrl(tsUrl);
      setAutoCreatePerson(acpRaw === 'true' || acpRaw === '1');
      // Open free-text mode when the persisted value is not in our common list.
      if (tz && !COMMON_IANA_TIMEZONES.includes(tz)) {
        setTzCustomMode(true);
      }
    } catch {
      // Non-fatal — sliders fall back to defaults; user can still use the
      // standard Settings tab to change values.
    }
  };

  const fetchOrphanCounts = async () => {
    if (!apiBaseUrl || !accessToken) return;
    try {
      const r = await fetch(`${apiBaseUrl}/s/zadarma/orphans/counts`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await r.json()) as { ok?: boolean; unlinkedCalls?: number; unlinkedSms?: number };
      if (json.ok) {
        setOrphanCounts({ calls: json.unlinkedCalls ?? 0, sms: json.unlinkedSms ?? 0 });
      }
    } catch {
      // Non-fatal — counter just stays hidden if the endpoint is unreachable.
    }
  };

  const runRescan = async () => {
    if (!apiBaseUrl || !accessToken || rescanning) return;
    setRescanning(true);
    setRescanResult(null);
    try {
      const r = await fetch(`${apiBaseUrl}/s/zadarma/orphans/rescan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await r.json()) as {
        ok?: boolean;
        scannedCalls?: number;
        linkedCalls?: number;
        scannedSms?: number;
        linkedSms?: number;
      };
      if (json.ok) {
        setRescanResult(
          `Linked ${json.linkedCalls ?? 0} calls and ${json.linkedSms ?? 0} SMS (scanned ${json.scannedCalls ?? 0} / ${json.scannedSms ?? 0}).`,
        );
        await fetchOrphanCounts();
      } else {
        setRescanResult('Rescan failed — check server logs.');
      }
    } catch (e) {
      setRescanResult(e instanceof Error ? e.message : String(e));
    } finally {
      setRescanning(false);
    }
  };

  const fetchLastContactedCounts = async () => {
    if (!apiBaseUrl || !accessToken) return;
    try {
      const r = await fetch(`${apiBaseUrl}/s/zadarma/last-contacted/counts`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await r.json()) as {
        ok?: boolean;
        total?: number;
        withTimestamp?: number;
        withoutTimestamp?: number;
      };
      if (json.ok) {
        setLastContactedCounts({
          total: json.total ?? 0,
          withTimestamp: json.withTimestamp ?? 0,
          withoutTimestamp: json.withoutTimestamp ?? 0,
        });
      }
    } catch {
      // Non-fatal — counter just stays hidden if the endpoint is unreachable.
    }
  };

  const runSync = async () => {
    if (!apiBaseUrl || !accessToken || syncing) return;
    if (customRangeInvalid) return;
    setSyncing(true);
    setSyncStartedAt(Date.now());
    setSyncResult(null);
    try {
      const body: { fromIso?: string; toIso?: string } = {};
      if (syncMode === 'custom') {
        body.fromIso = new Date(syncFromLocal).toISOString();
        body.toIso = new Date(syncToLocal).toISOString();
      }
      const r = await fetch(`${apiBaseUrl}/s/zadarma/sync-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      const json = (await r.json()) as {
        ok?: boolean;
        error?: string;
        fetched?: number;
        created?: number;
        skippedDup?: number;
        linked?: number;
        failed?: number;
        costed?: number;
        windowFrom?: string;
        windowTo?: string;
      };
      if (json.ok) {
        const window =
          json.windowFrom && json.windowTo
            ? ` (${json.windowFrom.slice(0, 16).replace('T', ' ')} → ${json.windowTo.slice(0, 16).replace('T', ' ')} UTC)`
            : '';
        const costPart = (json.costed ?? 0) > 0 ? `, cost ${json.costed}` : '';
        setSyncResult(
          `Created ${json.created ?? 0} new (skipped ${json.skippedDup ?? 0} dup, linked ${json.linked ?? 0}${costPart}, fetched ${json.fetched ?? 0})${window}.`,
        );
        await fetchOrphanCounts();
        await fetchLastContactedCounts();
      } else {
        setSyncResult(`Sync failed: ${json.error ?? 'unknown error'}`);
      }
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
      setSyncStartedAt(null);
    }
  };

  const runEnrich = async () => {
    if (!apiBaseUrl || !accessToken || enriching) return;
    setEnriching(true);
    setEnrichStartedAt(Date.now());
    setEnrichResult(null);
    try {
      const r = await fetch(`${apiBaseUrl}/s/zadarma/enrich-call-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      const json = (await r.json()) as {
        ok?: boolean;
        error?: string;
        scanned?: number;
        pickedForEnrichment?: number;
        enrichment?: {
          processed?: number;
          enrichedRecording?: number;
          enrichedTranscript?: number;
          skippedShort?: number;
          skippedNoCallId?: number;
          transcriptInProgress?: number;
          transcriptNotAvailable?: number;
          recordingFailed?: number;
          transcriptFailed?: number;
          mutationFailed?: number;
          budgetExceeded?: number;
        } | null;
      };
      if (!json.ok) {
        setEnrichResult(`Enrichment failed: ${json.error ?? 'unknown error'}`);
        return;
      }
      const e = json.enrichment;
      if (!e || (json.pickedForEnrichment ?? 0) === 0) {
        setEnrichResult('Nothing to enrich — every callLog already has a recording / transcript.');
        return;
      }
      const parts = [
        `recordings ${e.enrichedRecording ?? 0}`,
        `transcripts ${e.enrichedTranscript ?? 0}`,
      ];
      if ((e.skippedNoCallId ?? 0) > 0) parts.push(`skippedNoCallId ${e.skippedNoCallId}`);
      if ((e.transcriptInProgress ?? 0) > 0) parts.push(`inProgress ${e.transcriptInProgress}`);
      if ((e.transcriptNotAvailable ?? 0) > 0) parts.push(`unavailable ${e.transcriptNotAvailable}`);
      if ((e.recordingFailed ?? 0) > 0) parts.push(`recFail ${e.recordingFailed}`);
      if ((e.transcriptFailed ?? 0) > 0) parts.push(`trFail ${e.transcriptFailed}`);
      if ((e.budgetExceeded ?? 0) > 0) parts.push(`budgetExceeded ${e.budgetExceeded}`);
      setEnrichResult(
        `Processed ${e.processed ?? 0} of ${json.pickedForEnrichment} (scanned ${json.scanned ?? 0}). ${parts.join(', ')}. Click again to continue.`,
      );
    } catch (e) {
      setEnrichResult(e instanceof Error ? e.message : String(e));
    } finally {
      setEnriching(false);
      setEnrichStartedAt(null);
    }
  };

  const runRecomputeCosts = async () => {
    if (!apiBaseUrl || !accessToken || recomputingCosts) return;
    setRecomputingCosts(true);
    setRecomputeCostsStartedAt(Date.now());
    setRecomputeCostsResult(null);
    try {
      // Drain pages until hasMore=false, so the user gets a single
      // "everything is up to date" terminal message even on workspaces
      // with thousands of callLogs. The endpoint's per-call limit
      // (default 250, max 500) protects the logic-function timeout;
      // we just iterate.
      let totalUpdated = 0;
      let totalCleared = 0;
      let totalUnchanged = 0;
      let totalScanned = 0;
      let totalFailed = 0;
      for (;;) {
        const r = await fetch(`${apiBaseUrl}/s/zadarma/recompute-costs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({}),
        });
        const json = (await r.json()) as {
          ok?: boolean;
          error?: string;
          scanned?: number;
          picked?: number;
          updated?: number;
          unchanged?: number;
          cleared?: number;
          failed?: number;
          hasMore?: boolean;
        };
        if (!json.ok) {
          setRecomputeCostsResult(`Recompute failed: ${json.error ?? 'unknown error'}`);
          return;
        }
        totalUpdated += json.updated ?? 0;
        totalCleared += json.cleared ?? 0;
        totalUnchanged += json.unchanged ?? 0;
        totalScanned += json.scanned ?? 0;
        totalFailed += json.failed ?? 0;
        if (!json.hasMore) break;
      }
      if (totalUpdated === 0 && totalCleared === 0) {
        setRecomputeCostsResult(
          `Nothing to update — every outbound callLog already matches the configured rates (scanned ${totalScanned}, unchanged ${totalUnchanged}).`,
        );
      } else {
        setRecomputeCostsResult(
          `Updated ${totalUpdated} (cleared ${totalCleared}) of ${totalScanned} scanned. Unchanged ${totalUnchanged}${totalFailed > 0 ? `, failed ${totalFailed}` : ''}.`,
        );
      }
    } catch (e) {
      setRecomputeCostsResult(e instanceof Error ? e.message : String(e));
    } finally {
      setRecomputingCosts(false);
      setRecomputeCostsStartedAt(null);
    }
  };

  const saveRateAndRecompute = async (key: string, value: string) => {
    await updateAppVar(key, value);
    // Auto-fire recompute so analytics reflect the new rate immediately
    // — closest we can get to a Google-Sheets-style live formula in a
    // schema-stored CURRENCY field.
    runRecomputeCosts();
  };

  // Drains pagination by calling /zadarma/teamsale-backfill until
  // hasMore=false. Each call processes up to ~200 Persons over a 280s
  // soft budget (the function has 300s hard timeout). Idempotent —
  // already-linked Persons are filtered at the query layer.
  const runTeamsaleBackfill = async () => {
    if (!apiBaseUrl || !accessToken || teamsaleSyncing) return;
    if (!teamsaleBaseUrl.trim()) {
      setTeamsaleSyncResult('Set TeamSale base URL first.');
      return;
    }
    setTeamsaleSyncing(true);
    setTeamsaleSyncResult(null);
    setTeamsaleSyncStartedAt(Date.now());
    try {
      let totalScanned = 0;
      let totalSynced = 0;
      let totalSkipped = 0;
      let totalRateLimited = 0;
      let totalFailed = 0;
      let safetyCounter = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (++safetyCounter > 25) break; // soft cap ~25 × 200 = 5000 Persons / click
        const r = await fetch(`${apiBaseUrl}/s/zadarma/teamsale-backfill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({}),
        });
        const json = (await r.json()) as {
          ok?: boolean;
          error?: string;
          scanned?: number;
          synced?: number;
          skipped?: number;
          rateLimited?: number;
          failed?: number;
          hasMore?: boolean;
          budgetExceeded?: boolean;
        };
        if (!json.ok) {
          setTeamsaleSyncResult(`Backfill failed: ${json.error ?? 'unknown error'}`);
          return;
        }
        totalScanned += json.scanned ?? 0;
        totalSynced += json.synced ?? 0;
        totalSkipped += json.skipped ?? 0;
        totalRateLimited += json.rateLimited ?? 0;
        totalFailed += json.failed ?? 0;
        if (!json.hasMore) break;
      }
      if (totalScanned === 0) {
        setTeamsaleSyncResult(
          'Nothing to sync — every Person with a primary phone already has a TeamSale link.',
        );
      } else {
        const parts = [`Synced ${totalSynced} of ${totalScanned}`];
        if (totalSkipped > 0) parts.push(`skipped ${totalSkipped}`);
        if (totalRateLimited > 0) parts.push(`rate-limited ${totalRateLimited}`);
        if (totalFailed > 0) parts.push(`failed ${totalFailed}`);
        setTeamsaleSyncResult(parts.join(', ') + '.');
      }
    } catch (e) {
      setTeamsaleSyncResult(e instanceof Error ? e.message : String(e));
    } finally {
      setTeamsaleSyncing(false);
      setTeamsaleSyncStartedAt(null);
    }
  };

  const runRecompute = async () => {
    if (!apiBaseUrl || !accessToken || recomputing) return;
    setRecomputing(true);
    setRecomputeResult(null);
    try {
      const r = await fetch(`${apiBaseUrl}/s/zadarma/last-contacted/recompute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await r.json()) as {
        ok?: boolean;
        personsConsidered?: number;
        scannedCalls?: number;
        scannedSms?: number;
        updated?: number;
        skippedSameOrNewer?: number;
      };
      if (json.ok) {
        setRecomputeResult(
          `Updated ${json.updated ?? 0} of ${json.personsConsidered ?? 0} Persons (scanned ${json.scannedCalls ?? 0} calls, ${json.scannedSms ?? 0} SMS; skipped ${json.skippedSameOrNewer ?? 0} same-or-newer).`,
        );
        await fetchLastContactedCounts();
      } else {
        setRecomputeResult('Recompute failed — check server logs.');
      }
    } catch (e) {
      setRecomputeResult(e instanceof Error ? e.message : String(e));
    } finally {
      setRecomputing(false);
    }
  };

  useEffect(() => {
    refreshInfo();
    fetchAppVars();
    fetchOrphanCounts();
    fetchLastContactedCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateAppVar = async (key: string, value: string) => {
    if (!apiBaseUrl || !accessToken || !appId) return;
    setSavingVar(key);
    try {
      // updateOneApplicationVariable returns Boolean! — no selection set allowed.
      const r = await fetch(`${apiBaseUrl}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          query: `mutation Save($key: String!, $value: String!, $applicationId: UUID!) { updateOneApplicationVariable(key: $key, value: $value, applicationId: $applicationId) }`,
          variables: { key, value, applicationId: appId },
        }),
      });
      const json = (await r.json()) as { errors?: Array<{ message?: string }> };
      if (json.errors?.length) {
        console.warn('updateOneApplicationVariable failed', json.errors);
      }
    } finally {
      setSavingVar(null);
    }
  };

  const testWebhook = async (url: string, setter: (s: WebhookCheck) => void) => {
    setter({ status: 'pending' });
    const echo = `tw-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const r = await fetch(`${url}?zd_echo=${echo}`, { method: 'GET' });
      const text = (await r.text()).trim().replace(/^"|"$/g, '');
      if (r.ok && text === echo) {
        setter({ status: 'ok', detail: 'echo matched (this server reachable from your browser)' });
      } else {
        setter({ status: 'fail', detail: `HTTP ${r.status}, body=${text.slice(0, 80)}` });
      }
    } catch (e) {
      setter({ status: 'fail', detail: e instanceof Error ? e.message : String(e) });
    }
  };

  // Validates the AI enrichment endpoint registration without requiring a real
  // workspace API key: posts a dummy body (toNumber that won't match any
  // callLog) using the App's own access token. A 200 with `matched:false` is
  // the success signal — the endpoint executed, auth passed, no row matched.
  const testEnrichmentWebhook = async () => {
    if (!apiBaseUrl || !accessToken) {
      setEnrichCheck({ status: 'fail', detail: 'access token not available in this context' });
      return;
    }
    setEnrichCheck({ status: 'pending' });
    try {
      const r = await fetch(enrichmentEndpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ match: { toNumber: '+00000000000' } }),
      });
      const json = (await r.json().catch(() => null)) as
        | { ok?: boolean; matched?: boolean; error?: string; reason?: string }
        | null;
      if (r.ok && json?.ok === true && json.matched === false) {
        setEnrichCheck({
          status: 'ok',
          detail: 'endpoint reachable, auth ok (dummy match returned matched:false as expected)',
        });
      } else if (r.ok && json?.ok === true && json.matched === true) {
        // Vanishingly unlikely with dummy number, but treat as alive.
        setEnrichCheck({ status: 'ok', detail: 'endpoint reachable (matched a real row)' });
      } else {
        const why = json?.error ?? json?.reason ?? '(no body)';
        setEnrichCheck({ status: 'fail', detail: `HTTP ${r.status} — ${why}`.slice(0, 160) });
      }
    } catch (e) {
      setEnrichCheck({ status: 'fail', detail: e instanceof Error ? e.message : String(e) });
    }
  };

  // Selects the element's text and best-effort attempts a programmatic
  // copy. Twenty's iframe sandbox can silently no-op the underlying
  // clipboard write so we don't show a hint — the visible text selection
  // is the cue, the user presses Ctrl/⌘+C themselves.
  const handleCopy = (text: string, target?: HTMLElement | null) => {
    void copyToClipboard(text, target);
  };

  // ── styles
  // All colours pulled from Twenty's CSS theme tokens (see
  // packages/twenty-ui/src/theme-constants/themeCssVariables.ts) so light/dark
  // theme switches in the Twenty UI propagate automatically.
  const container: CSSProperties = {
    padding: 24, display: 'flex', flexDirection: 'column', gap: 24,
    fontFamily: 'inherit',
    // Twenty's iframe body colour isn't reliably applied to text inside
    // <code>/<pre>/<span> children, so they inherit black-ish defaults and
    // disappear against dark-mode backgrounds. Anchoring the colour here
    // makes every descendant theme-aware via inheritance.
    color: 'var(--t-font-color-primary)',
  };
  const section: CSSProperties = {
    background: 'var(--t-background-primary)', borderRadius: 8,
    border: '1px solid var(--t-border-color-light)', padding: 16,
  };
  const sectionTitle: CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--t-font-color-primary)' };
  const sectionHelp: CSSProperties = { fontSize: 12, color: 'var(--t-font-color-secondary)', marginBottom: 12, lineHeight: 1.5 };
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 };
  const labelCol: CSSProperties = { color: 'var(--t-font-color-secondary)', minWidth: 130 };
  const codeBox: CSSProperties = {
    flex: 1, fontFamily: 'monospace', fontSize: 12, background: 'var(--t-background-secondary)',
    padding: '4px 8px', borderRadius: 4, border: '1px solid var(--t-border-color-light)', wordBreak: 'break-all',
  };
  const codeBoxClickable: CSSProperties = {
    ...codeBox, cursor: 'pointer', userSelect: 'all',
  };
  const button = (variant: 'primary' | 'ghost' = 'ghost', disabled = false): CSSProperties => ({
    padding: '4px 10px', fontSize: 12,
    border: variant === 'primary' ? 'none' : '1px solid var(--t-border-color-medium)',
    background: disabled
      ? 'var(--t-background-tertiary)'
      : variant === 'primary'
        ? 'var(--t-color-blue)'
        : 'var(--t-background-primary)',
    // When disabled, always use the theme-primary font colour. The previous
    // `inverted` colour (light text, designed for the blue primary fill)
    // becomes light-on-light on the muted tertiary background in light
    // theme, and the dark ghost colour becomes dark-on-dark in dark theme —
    // either way the label disappears. `--t-font-color-primary` flips with
    // theme and stays readable against `--t-background-tertiary`.
    color: disabled
      ? 'var(--t-font-color-primary)'
      : variant === 'primary'
        ? 'var(--t-font-color-inverted)'
        : 'var(--t-font-color-primary)',
    borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 500,
  });
  const badge = (color: string): CSSProperties => ({
    padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 10,
    background: color, color: 'var(--t-font-color-inverted)', display: 'inline-block',
  });

  const checkBadge = (c: WebhookCheck) => {
    if (c.status === 'idle') return null;
    if (c.status === 'pending') return <span style={badge('var(--t-color-gray)')}>checking…</span>;
    if (c.status === 'ok') return <span style={badge('var(--t-color-green)')}>✓ ok</span>;
    return <span style={badge('var(--t-color-red)')}>✗ fail</span>;
  };

  const linkStyle: CSSProperties = { color: 'var(--t-color-blue)', textDecoration: 'underline' };

  const tzMissing = appId !== null && cabinetTimezone.trim() === '';

  return (
    <div style={container}>
      {tzMissing && (
        <div style={{
          background: 'var(--t-background-transparent-danger)',
          border: '1px solid var(--t-font-color-danger)',
          borderRadius: 8,
          padding: 12,
          fontSize: 13,
          color: 'var(--t-font-color-danger)',
          lineHeight: 1.5,
        }}>
          <strong>⚠ Cabinet timezone not configured.</strong> Live call records
          will be saved without start time until you set this in
          <strong> Behaviour → Cabinet timezone</strong> below. Existing data is
          unaffected.
        </div>
      )}
      {/* ── 1. Connection status */}
      <div style={section}>
        <div style={sectionTitle}>Zadarma connection</div>
        {infoLoading && <div style={{ fontSize: 13, color: 'var(--t-font-color-secondary)' }}>Loading…</div>}
        {!infoLoading && info?.ok && (
          <>
            <div style={row}>
              <span style={labelCol}>Balance</span>
              <strong>{info.balance?.toFixed(2)} {info.currency}</strong>
              {info.balance !== undefined && info.balance < 1 && (
                <span style={{ ...badge('var(--t-color-orange)'), marginLeft: 8 }}>low balance</span>
              )}
            </div>
            {info.tariff && (
              <div style={row}>
                <span style={labelCol}>Tariff</span>
                <span>{info.tariff}</span>
              </div>
            )}
            <div style={row}>
              <span style={labelCol}>Direct numbers</span>
              <span>{info.numbers?.length ?? 0}</span>
            </div>
            {info.numbers && info.numbers.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
                {info.numbers.map((n, i) => (
                  <div key={n.number ?? i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                    <code style={{ fontFamily: 'monospace' }}>+{n.number}</code>
                    {n.description && <span>· {n.description}</span>}
                    {n.country && <span style={{ opacity: 0.6 }}>· {n.country}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!infoLoading && info && !info.ok && (
          <div style={{
            fontSize: 13,
            color: 'var(--t-font-color-danger)',
            background: 'var(--t-background-transparent-danger)',
            padding: 8,
            borderRadius: 4,
          }}>
            ⚠ {info.error ?? 'connection failed'}
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
              Check ZADARMA_USER_KEY and ZADARMA_SECRET in the Settings tab.
            </div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="button" style={button('ghost', infoLoading)} onClick={() => refreshInfo()} disabled={infoLoading}>
            {infoLoading ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </div>

      {/* ── 2. Friendly settings (override default tab) */}
      <div style={section}>
        <div style={sectionTitle}>Behaviour</div>
        <div style={sectionHelp}>
          Friendlier controls for the same applicationVariables you can also edit on the Settings tab.
          Changes save immediately.
        </div>

        {(() => {
          const didsList = zadarmaDids
            .split(',')
            .map((s) => s.replace(/\D+/g, ''))
            .filter((d) => d.length >= 6);
          const writeDids = (list: string[]) => {
            const csv = list.join(',');
            setZadarmaDids(csv);
            updateAppVar('ZADARMA_DIDS', csv);
          };
          const toggleDid = (num: string) => {
            if (didsList.includes(num)) {
              writeDids(didsList.filter((d) => d !== num));
            } else {
              writeDids([...didsList, num]);
            }
          };
          const setDefaultDid = (num: string) => {
            // Bring num to first position; auto-include if not yet checked.
            writeDids([num, ...didsList.filter((d) => d !== num)]);
          };
          const useCheckboxList =
            info?.numbers !== undefined && info.numbers.length > 0;
          return (
            <>
              <div style={row}>
                <span style={labelCol}>Our outbound DIDs</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {useCheckboxList ? (
                    info.numbers!.map((n) => {
                      const num = (n.number ?? '').replace(/\D+/g, '');
                      if (!num) return null;
                      const included = didsList.includes(num);
                      const isDefault = didsList[0] === num;
                      return (
                        <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <input
                            type="radio"
                            name="zadarma-dids-default"
                            checked={isDefault}
                            onChange={() => setDefaultDid(num)}
                            disabled={!appId}
                            title="Mark as default sender"
                          />
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => toggleDid(num)}
                            disabled={!appId}
                          />
                          <span>+{num}{n.description ? ` · ${n.description}` : ''}</span>
                          {isDefault && included && (
                            <span style={{ color: 'var(--t-color-blue)', fontSize: 10, fontWeight: 600 }}>
                              ★ default
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <input
                      value={zadarmaDids}
                      placeholder="48570000808,380501234567"
                      onChange={(e: { detail?: { value?: string } }) => setZadarmaDids(e.detail?.value ?? '')}
                      onBlur={() => updateAppVar('ZADARMA_DIDS', zadarmaDids)}
                      disabled={!appId}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
                    />
                  )}
                </div>
                {savingVar === 'ZADARMA_DIDS' && (
                  <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)' }}>saving…</span>
                )}
              </div>
              <div style={{ ...sectionHelp, marginLeft: 200 }}>
                {useCheckboxList ? (
                  <>Tick numbers this workspace owns; the radio-star marks the default sender used to stamp outbound callLog rows and pre-fill the Person panel SMS form.</>
                ) : (
                  <>Comma-separated E.164 numbers without &quot;+&quot;. First entry = default sender. Configure ZADARMA_USER_KEY/SECRET to load your numbers as a checkbox list instead.</>
                )}
              </div>
            </>
          );
        })()}

        <div style={row}>
          <span style={labelCol}>Save transcripts</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={transcriptEnabled}
              onChange={(e: { detail?: { checked?: boolean } }) => {
                const next = e.detail?.checked ?? !transcriptEnabled;
                setTranscriptEnabled(next);
                updateAppVar('ZADARMA_TRANSCRIPT_ENABLED', next ? 'true' : 'false');
              }}
              disabled={!appId || savingVar === 'ZADARMA_TRANSCRIPT_ENABLED'}
            />
            <span style={{ fontSize: 12 }}>
              {transcriptEnabled ? 'Speech-recognition transcripts saved into callLog.transcript' : 'Disabled — transcripts ignored'}
            </span>
          </label>
          {savingVar === 'ZADARMA_TRANSCRIPT_ENABLED' && <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)' }}>saving…</span>}
        </div>

        <div style={row}>
          <span style={labelCol}>Cabinet timezone</span>
          {!tzCustomMode ? (
            <select
              value={COMMON_IANA_TIMEZONES.includes(cabinetTimezone) ? cabinetTimezone : ''}
              onChange={(e: { detail?: { value?: string } }) => {
                const next = e.detail?.value ?? '';
                if (next === '__custom__') {
                  setTzCustomMode(true);
                  setCabinetTimezone('');
                  return;
                }
                setCabinetTimezone(next);
                updateAppVar('ZADARMA_CABINET_TIMEZONE', next);
              }}
              disabled={!appId || savingVar === 'ZADARMA_CABINET_TIMEZONE'}
              style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
            >
              <option value="">— pick a timezone —</option>
              {COMMON_IANA_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
              <option value="__custom__">Other (type IANA name)…</option>
            </select>
          ) : (
            <>
              <input
                value={cabinetTimezone}
                placeholder="e.g. Pacific/Auckland"
                onChange={(e: { detail?: { value?: string } }) => setCabinetTimezone(e.detail?.value ?? '')}
                onBlur={() => {
                  const trimmed = cabinetTimezone.trim();
                  if (trimmed && tzValid) {
                    updateAppVar('ZADARMA_CABINET_TIMEZONE', trimmed);
                  }
                }}
                disabled={!appId}
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
              />
              <button
                type="button"
                style={button('ghost')}
                onClick={() => {
                  setTzCustomMode(false);
                  setCabinetTimezone('');
                  updateAppVar('ZADARMA_CABINET_TIMEZONE', '');
                }}
              >
                back to list
              </button>
            </>
          )}
          {tzCustomMode && tzValid === true && <span style={badge('var(--t-color-green)')}>✓ valid</span>}
          {tzCustomMode && tzValid === false && <span style={badge('var(--t-color-red)')}>✗ invalid IANA</span>}
          {savingVar === 'ZADARMA_CABINET_TIMEZONE' && <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)' }}>saving…</span>}
        </div>
        <div style={{ ...sectionHelp, marginTop: 4, marginBottom: 0, marginLeft: 138 }}>
          Pick the city closest to your Zadarma cabinet — same timezone shown
          in the Zadarma UI. Daylight-saving handled automatically. Pick
          "Other…" if your timezone is not in the list
          (<a href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones" target="_blank" rel="noopener noreferrer" style={linkStyle}>full reference</a>).
          Without this, live call records are saved without start time.
        </div>
      </div>

      {/* ── 3. Webhook endpoints */}
      <div style={section}>
        <div style={sectionTitle}>Webhook endpoints</div>
        <div style={sectionHelp}>
          Paste these into <strong>Zadarma cabinet → Marketplace → Notifications</strong> (
          <a href="https://my.zadarma.com/marketplace/" target="_blank" rel="noopener noreferrer" style={linkStyle}>open</a>
          ): the "O połączeniach / Call notifications" URL field gets the PBX URL below; the
          "O zdarzeniach / Event notifications" URL field gets the Events URL.
          The Test buttons below ping each endpoint with a <code>zd_echo</code> handshake from your browser — green
          means the endpoint logic works. <strong>Important:</strong> Zadarma's own "Test" button in their cabinet
          pings from the public internet, so the URL must be publicly reachable. On localhost you need a tunnel
          (cloudflared / ngrok); on Coolify or any cloud Twenty install it works directly.
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={row}>
            <span style={labelCol}>PBX (calls)</span>
            <code
              style={codeBoxClickable}
              onClick={(e) => handleCopy(pbxWebhookUrl, e.currentTarget as HTMLElement)}
            >
              {pbxWebhookUrl}
            </code>
            <button type="button" style={button('primary')} onClick={() => testWebhook(pbxWebhookUrl, setPbxCheck)}>Test</button>
            {checkBadge(pbxCheck)}
          </div>
          {pbxCheck.detail && <div style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 138 }}>{pbxCheck.detail}</div>}
        </div>

        <div>
          <div style={row}>
            <span style={labelCol}>Events (SMS)</span>
            <code
              style={codeBoxClickable}
              onClick={(e) => handleCopy(eventWebhookUrl, e.currentTarget as HTMLElement)}
            >
              {eventWebhookUrl}
            </code>
            <button type="button" style={button('primary')} onClick={() => testWebhook(eventWebhookUrl, setEventCheck)}>Test</button>
            {checkBadge(eventCheck)}
          </div>
          {eventCheck.detail && <div style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 138 }}>{eventCheck.detail}</div>}
        </div>
      </div>

      {/* ── 3a. AI enrichment endpoint (vendor-agnostic post-call enrichment) */}
      <div style={section}>
        <div style={sectionTitle}>AI enrichment endpoint</div>
        <div style={sectionHelp}>
          Endpoint that accepts post-call AI analysis from any vendor (Retell via n8n, Vapi, etc.)
          and attaches it to the matching <code>callLog</code> row. Idempotent via{' '}
          <code>correlationId</code>. Reachable from the public internet on any cloud Twenty install
          — point your n8n / vendor adapter at the URL below. The Test button validates registration
          using this App's own token (no workspace key required for the test).
        </div>

        <div style={row}>
          <span style={labelCol}>URL</span>
          <code
            style={codeBoxClickable}
            onClick={(e) => handleCopy(enrichmentEndpointUrl, e.currentTarget as HTMLElement)}
          >
            {enrichmentEndpointUrl}
          </code>
          <button
            type="button"
            style={button('primary', enrichCheck.status === 'pending')}
            onClick={() => testEnrichmentWebhook()}
            disabled={enrichCheck.status === 'pending'}
          >
            Test
          </button>
          {checkBadge(enrichCheck)}
        </div>
        {enrichCheck.detail && (
          <div style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 138 }}>
            {enrichCheck.detail}
          </div>
        )}

        <div style={{ ...row, alignItems: 'flex-start', marginTop: 4 }}>
          <span style={labelCol}>n8n quick start</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)' }}>
              Paste into n8n HTTP Request node → ⋮ menu → <strong>Import cURL</strong>. Replace{' '}
              <code style={{ fontFamily: 'monospace' }}>YOUR_WORKSPACE_API_KEY</code> and{' '}
              <code style={{ fontFamily: 'monospace' }}>&lt;placeholders&gt;</code> with n8n
              expressions.
            </span>
            <pre
              style={{
                ...codeBoxClickable,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: 11,
                lineHeight: 1.5,
                maxHeight: 220,
                overflow: 'auto',
              }}
              onClick={(e) =>
                handleCopy(
                  buildEnrichmentCurl(enrichmentEndpointUrl),
                  e.currentTarget as HTMLElement,
                )
              }
            >
              {buildEnrichmentCurl(enrichmentEndpointUrl)}
            </pre>
          </div>
        </div>

        <div style={row}>
          <span style={labelCol}>Method</span>
          <code style={{ fontFamily: 'monospace', fontSize: 12 }}>POST</code>
        </div>

        <div style={row}>
          <span style={labelCol}>Auth</span>
          <span style={{ fontSize: 12 }}>
            <code style={{ fontFamily: 'monospace' }}>Bearer &lt;workspace API key&gt;</code> — create
            one in <strong>Settings → Developers → API Keys</strong>. <strong>Do not</strong> use
            this App's own token — it has narrower scope and is rotated on App reinstall.
          </span>
        </div>

        <div style={row}>
          <span style={labelCol}>Body</span>
          <span style={{ fontSize: 12 }}>
            <code style={{ fontFamily: 'monospace' }}>{'{ match, data }'}</code> — match resolves
            the callLog (by <code>correlationId</code>, phone + timestamp, or recent fallback);
            data carries vendor metrics (sentiment, success, transcript, etc.).
          </span>
        </div>

        <div style={{ ...sectionHelp, marginTop: 8, marginBottom: 0 }}>
          Full contract, field reference, Retell mapping table and paste-ready n8n snippets:{' '}
          <a href={enrichmentDocsUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            docs/AI_ENRICHMENT.md
          </a>
          .
        </div>
      </div>

      {/* ── 3b. SMS send endpoint (used by chat panel + n8n / Twenty Workflows) */}
      <div style={section}>
        <div style={sectionTitle}>SMS send endpoint</div>
        <div style={sectionHelp}>
          Send an outbound SMS through Zadarma and write a corresponding{' '}
          <code>smsLog</code> row in one HTTP call. The Zadarma chat panel on every
          Person record uses this endpoint internally; n8n / Twenty Workflows /
          external automation can hit it directly with the same contract. Honours{' '}
          <code>Person.doNotSms</code> opt-out automatically and refuses with{' '}
          <code>OPT_OUT</code> if the flag is set — no charge incurred and no row
          written. Optional analytics tags (<code>category</code>,{' '}
          <code>source</code>, <code>templateName</code>, <code>campaignId</code>)
          let dashboards group sent SMS by type / origin / template / campaign.
        </div>

        <div style={row}>
          <span style={labelCol}>URL</span>
          <code
            style={codeBoxClickable}
            onClick={(e) => handleCopy(sendSmsWebhookUrl, e.currentTarget as HTMLElement)}
          >
            {sendSmsWebhookUrl}
          </code>
        </div>

        <div style={{ ...row, alignItems: 'flex-start', marginTop: 4 }}>
          <span style={labelCol}>n8n quick start</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)' }}>
              Paste into n8n HTTP Request node → ⋮ menu → <strong>Import cURL</strong>. Replace{' '}
              <code style={{ fontFamily: 'monospace' }}>YOUR_WORKSPACE_API_KEY</code> and{' '}
              <code style={{ fontFamily: 'monospace' }}>&lt;placeholders&gt;</code> with n8n
              expressions.
            </span>
            <pre
              style={{
                ...codeBoxClickable,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: 11,
                lineHeight: 1.5,
                maxHeight: 220,
                overflow: 'auto',
              }}
              onClick={(e) =>
                handleCopy(
                  buildSendSmsCurl(sendSmsWebhookUrl),
                  e.currentTarget as HTMLElement,
                )
              }
            >
              {buildSendSmsCurl(sendSmsWebhookUrl)}
            </pre>
          </div>
        </div>

        <div style={row}>
          <span style={labelCol}>Method</span>
          <code style={{ fontFamily: 'monospace', fontSize: 12 }}>POST</code>
        </div>

        <div style={row}>
          <span style={labelCol}>Auth</span>
          <span style={{ fontSize: 12 }}>
            <code style={{ fontFamily: 'monospace' }}>Bearer &lt;workspace API key&gt;</code> — create
            one in <strong>Settings → Developers → API Keys</strong>. <strong>Do not</strong> use
            this App's own token — it has narrower scope and is rotated on App reinstall.
          </span>
        </div>

        <div style={row}>
          <span style={labelCol}>Body</span>
          <span style={{ fontSize: 12 }}>
            <code style={{ fontFamily: 'monospace' }}>
              {'{ to, from, message, personId?, category?, source?, templateName?, campaignId? }'}
            </code>
            {' '}— urlencoded or JSON. <code style={{ fontFamily: 'monospace' }}>category</code> ∈{' '}
            <code>TRANSACTIONAL / MARKETING / REMINDER / FOLLOWUP / CONFIRMATION / OTHER</code>;{' '}
            <code style={{ fontFamily: 'monospace' }}>source</code> ∈{' '}
            <code>CHAT_PANEL / N8N / TWENTY_WORKFLOW / EXTERNAL_API / INBOUND / OTHER</code>. Unknown
            enum values gracefully fall back to <code>OTHER</code> instead of failing the send.
            Free-form fields are trimmed; empty strings collapse to null.
          </span>
        </div>

        <div style={row}>
          <span style={labelCol}>Refused</span>
          <span style={{ fontSize: 12 }}>
            Returns <code style={{ fontFamily: 'monospace' }}>{'{ ok: false, error: "OPT_OUT" }'}</code>
            {' '}with no Zadarma call and no <code>smsLog</code> row when the target Person has{' '}
            <code>doNotSms = true</code>. The chat panel mirrors this with a banner; external
            callers should surface the same to operators.
          </span>
        </div>

        <div style={{ ...sectionHelp, marginTop: 8, marginBottom: 0 }}>
          The four analytics tags are also returned on every <code>smsLog</code> row, so
          group_by analytics in Twenty's list view (e.g. by <code>source</code> or{' '}
          <code>category</code>) work natively without any extra setup.
        </div>
      </div>

      {/* ── 4. Orphans (calls/SMS without a Person) */}
      <div style={section}>
        <div style={sectionTitle}>Orphan records</div>
        <div style={sectionHelp}>
          Calls and SMS that arrived before the matching Person existed are kept with no Person link.
          New Persons are auto-linked on create/update; this button does a full sweep across every Person phone
          (primary + additional) and links every orphan that matches.
        </div>
        {orphanCounts && (
          <>
            <div style={row}>
              <span style={labelCol}>Calls without Person</span>
              <strong>{orphanCounts.calls}</strong>
            </div>
            <div style={row}>
              <span style={labelCol}>SMS without Person</span>
              <strong>{orphanCounts.sms}</strong>
            </div>
          </>
        )}
        {!orphanCounts && (
          <div style={{ fontSize: 12, color: 'var(--t-font-color-secondary)', marginBottom: 8 }}>
            Loading counters…
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            style={button(
              'primary',
              rescanning || (orphanCounts?.calls === 0 && orphanCounts?.sms === 0),
            )}
            onClick={() => runRescan()}
            disabled={rescanning || (orphanCounts?.calls === 0 && orphanCounts?.sms === 0)}
          >
            {rescanning ? 'Rescanning…' : 'Re-link orphans'}
          </button>
          <button type="button" style={button('ghost', rescanning)} onClick={() => fetchOrphanCounts()} disabled={rescanning}>
            Refresh counts
          </button>
          {rescanResult && (
            <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
              {rescanResult}
            </span>
          )}
        </div>
      </div>

      {/* ── 4a. Sync calls from Zadarma */}
      <div style={section}>
        <div style={sectionTitle}>Sync calls from Zadarma</div>
        <div style={sectionHelp}>
          Pulls call history via Zadarma's <code>/v1/statistics/pbx/</code> API and inserts new
          callLog rows here. Deduplicated by <code>pbxCallId</code>, so re-running is safe and
          double-counting cannot happen. New rows are auto-linked to Persons by phone (last 9 digits).
          Default: incremental — fetches everything since the last call we know about (with a 1-hour
          overlap to catch late-arriving rows). Custom range capped at 1 year.
          {' '}Rate-limited to 3 requests/min by Zadarma; long ranges run in 31-day chunks
          (a 1-year range takes ~5 minutes).
        </div>

        <div style={row}>
          <span style={labelCol}>Mode</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginRight: 16 }}>
            <input
              type="radio"
              name="syncMode"
              checked={syncMode === 'incremental'}
              onChange={() => setSyncMode('incremental')}
              disabled={syncing}
            />
            <span style={{ fontSize: 12 }}>Incremental (since last call)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="syncMode"
              checked={syncMode === 'custom'}
              onChange={() => setSyncMode('custom')}
              disabled={syncing}
            />
            <span style={{ fontSize: 12 }}>Custom range</span>
          </label>
        </div>

        {syncMode === 'custom' && (
          <>
            <div style={row}>
              <span style={labelCol}>From</span>
              <input
                type="datetime-local"
                value={syncFromLocal}
                onChange={(e: { detail?: { value?: string } }) => setSyncFromLocal(e.detail?.value ?? '')}
                disabled={syncing}
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
              />
            </div>
            <div style={row}>
              <span style={labelCol}>To</span>
              <input
                type="datetime-local"
                value={syncToLocal}
                onChange={(e: { detail?: { value?: string } }) => setSyncToLocal(e.detail?.value ?? '')}
                disabled={syncing}
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
              />
            </div>
            {customRangeDays !== null && (
              <div style={{ ...sectionHelp, marginTop: 4, marginBottom: 0, marginLeft: 138 }}>
                {customRangeDays > 365 ? (
                  <span style={{ color: 'var(--t-font-color-danger)' }}>
                    ⚠ Range {customRangeDays.toFixed(1)} days exceeds the 365-day limit. Narrow the window.
                  </span>
                ) : (
                  <span>Range: {customRangeDays.toFixed(1)} days. Times are interpreted in your browser's local timezone.</span>
                )}
              </div>
            )}
            {customRangeDays === null && syncFromLocal && syncToLocal && (
              <div style={{ ...sectionHelp, marginTop: 4, marginBottom: 0, marginLeft: 138, color: 'var(--t-font-color-danger)' }}>
                ⚠ &quot;To&quot; must be after &quot;From&quot;.
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            style={button('primary', syncing || customRangeInvalid)}
            onClick={() => runSync()}
            disabled={syncing || customRangeInvalid}
          >
            {syncing ? `Syncing… (${elapsedLabel(syncStartedAt)})` : 'Sync calls'}
          </button>
          {syncResult && (
            <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
              {syncResult}
            </span>
          )}
        </div>
      </div>

      {/* ── 4a-bis. Enrich missing recordings & transcripts */}
      <div style={section}>
        <div style={sectionTitle}>Enrich missing recordings &amp; transcripts</div>
        <div style={sectionHelp}>
          Adds Zadarma recording links and speech-recognition transcripts to existing callLog rows that lack
          them — typically rows synced before v0.17.0 (when this enrichment was added to the sync pipeline)
          or rows whose initial enrichment was deferred because the sync batch was too large.
          {' '}
          Skips calls shorter than 10 s (autoresponder / hang-ups). Transcript back-fill needs the
          Asterisk <code>call_id</code>: legacy rows synced before v0.17.0 don't have it stored, so they
          receive the recording link but no transcript. Newly synced rows have both. Idempotent — click
          repeatedly until the message reads &quot;Nothing to enrich&quot;. Each click processes up to 100
          rows over ~4 minutes (Zadarma rate-limit).
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            style={button('primary', enriching)}
            onClick={() => runEnrich()}
            disabled={enriching}
          >
            {enriching ? `Enriching… (${elapsedLabel(enrichStartedAt)})` : 'Enrich missing'}
          </button>
          {enrichResult && (
            <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
              {enrichResult}
            </span>
          )}
        </div>
      </div>

      {/* ── 4a-ter. Cost rates & recompute */}
      <div style={section}>
        <div style={sectionTitle}>Cost rates &amp; recompute</div>
        <div style={sectionHelp}>
          Zadarma's API doesn't expose per-call cost on most tariffs, so we compute it from a
          per-minute rate × <code>duration / 60</code>. Set rates once below; sync uses them on every
          new row, and changing a rate auto-fires a recompute over every existing outbound row so
          dashboards stay in sync. Inbound calls are always <code>null</code> — the called party pays.
          Empty rate = cost not computed for that callerType bucket.
        </div>

        <div style={row}>
          <span style={labelCol}>Zadarma rate /min</span>
          <input
            type="text"
            value={zadarmaRatePerMinute}
            onChange={(e: { detail?: { value?: string } }) => setZadarmaRatePerMinute(e.detail?.value ?? '')}
            onBlur={() => saveRateAndRecompute('ZADARMA_RATE_PER_MINUTE', zadarmaRatePerMinute.trim())}
            disabled={!appId || savingVar === 'ZADARMA_RATE_PER_MINUTE'}
            placeholder="0.05"
            style={{ width: 120, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
          />
          <input
            type="text"
            value={zadarmaRateCurrency}
            onChange={(e: { detail?: { value?: string } }) => setZadarmaRateCurrency((e.detail?.value ?? '').toUpperCase())}
            onBlur={() => saveRateAndRecompute('ZADARMA_RATE_CURRENCY', zadarmaRateCurrency.trim().toUpperCase())}
            disabled={!appId || savingVar === 'ZADARMA_RATE_CURRENCY'}
            placeholder="USD"
            maxLength={3}
            style={{ width: 70, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', marginLeft: 8 }}
          />
          {(savingVar === 'ZADARMA_RATE_PER_MINUTE' || savingVar === 'ZADARMA_RATE_CURRENCY') && (
            <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 8 }}>saving…</span>
          )}
        </div>

        <div style={row}>
          <span style={labelCol}>AI rate /min</span>
          <input
            type="text"
            value={aiRatePerMinute}
            onChange={(e: { detail?: { value?: string } }) => setAiRatePerMinute(e.detail?.value ?? '')}
            onBlur={() => saveRateAndRecompute('AI_RATE_PER_MINUTE', aiRatePerMinute.trim())}
            disabled={!appId || savingVar === 'AI_RATE_PER_MINUTE'}
            placeholder="0.50"
            style={{ width: 120, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
          />
          <input
            type="text"
            value={aiRateCurrency}
            onChange={(e: { detail?: { value?: string } }) => setAiRateCurrency((e.detail?.value ?? '').toUpperCase())}
            onBlur={() => saveRateAndRecompute('AI_RATE_CURRENCY', aiRateCurrency.trim().toUpperCase())}
            disabled={!appId || savingVar === 'AI_RATE_CURRENCY'}
            placeholder="USD"
            maxLength={3}
            style={{ width: 70, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', marginLeft: 8 }}
          />
          {(savingVar === 'AI_RATE_PER_MINUTE' || savingVar === 'AI_RATE_CURRENCY') && (
            <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 8 }}>saving…</span>
          )}
        </div>

        <div style={{ ...sectionHelp, marginLeft: 138, marginTop: 4 }}>
          Saving any rate above auto-recomputes every outbound callLog. The button below is for
          manual re-runs (e.g. after a duration backfill or migration).
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            style={button('primary', recomputingCosts)}
            onClick={() => runRecomputeCosts()}
            disabled={recomputingCosts}
          >
            {recomputingCosts ? `Recomputing… (${elapsedLabel(recomputeCostsStartedAt)})` : 'Recompute all costs'}
          </button>
          {recomputeCostsResult && (
            <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
              {recomputeCostsResult}
            </span>
          )}
        </div>
      </div>

      {/* ── 4a-quater. TeamSale backup link */}
      <div style={section}>
        <div style={sectionTitle}>TeamSale backup</div>
        <div style={sectionHelp}>
          Mirrors every Person in Twenty to a lead in your TeamSale (Zadarma free CRM) workspace
          and stores a clickable backlink in <code>Person.teamSaleLink</code>. TeamSale logs every
          call/SMS automatically — useful as a parallel source of truth in case of CRM data loss.
          Sync fires automatically on every Person <em>create</em> event (FB n8n flow, inbound
          webhook auto-create, manual UI, CSV import — all paths). Idempotent: already-linked
          Persons are skipped at the query layer.
        </div>

        <div style={row}>
          <span style={labelCol}>TeamSale base URL</span>
          <input
            type="text"
            value={teamsaleBaseUrl}
            onChange={(e: { detail?: { value?: string } }) => setTeamsaleBaseUrl(e.detail?.value ?? '')}
            onBlur={() => updateAppVar('TEAMSALE_BASE_URL', teamsaleBaseUrl.trim())}
            disabled={!appId || savingVar === 'TEAMSALE_BASE_URL'}
            placeholder="https://yourco.teamsale.com"
            style={{ width: 320, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
          />
          {savingVar === 'TEAMSALE_BASE_URL' && (
            <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 8 }}>saving…</span>
          )}
        </div>
        <div style={{ ...sectionHelp, marginLeft: 138, marginTop: 4 }}>
          Leave empty to disable TeamSale-sync entirely. Composed URLs use this prefix +
          <code>/leads/&lt;lead_id&gt;</code>.
        </div>

        <div style={{ ...row, marginTop: 8 }}>
          <span style={labelCol}>Auto-create Person</span>
          <input
            type="checkbox"
            checked={autoCreatePerson}
            onChange={(e: { detail?: { checked?: boolean } }) => {
              const next = e.detail?.checked ?? !autoCreatePerson;
              setAutoCreatePerson(next);
              updateAppVar('ZADARMA_AUTO_CREATE_PERSON', next ? 'true' : 'false');
            }}
            disabled={!appId || savingVar === 'ZADARMA_AUTO_CREATE_PERSON'}
            style={{ accentColor: 'var(--t-accent-color)' }}
          />
          <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 8 }}>
            {autoCreatePerson
              ? 'Inbound calls from unknown numbers create a Person automatically'
              : 'Disabled — unknown-caller callLogs are saved without a Person link'}
          </span>
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            style={button('primary', teamsaleSyncing)}
            onClick={() => runTeamsaleBackfill()}
            disabled={teamsaleSyncing || !teamsaleBaseUrl.trim()}
          >
            {teamsaleSyncing
              ? `Syncing… (${elapsedLabel(teamsaleSyncStartedAt)})`
              : 'Sync existing Persons to TeamSale'}
          </button>
          {teamsaleSyncResult && (
            <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
              {teamsaleSyncResult}
            </span>
          )}
        </div>
        <div style={{ ...sectionHelp, marginLeft: 138, marginTop: 4 }}>
          One-time sweep for Persons that pre-date the toggle (or were created during a window
          when sync was disabled). Throttled at ~1.2s per row to stay under Zadarma's 100 req/min
          limit; 1000 unsynced Persons take roughly 20 minutes. Filters at query layer →
          already-linked Persons are skipped without API calls.
        </div>
      </div>

      {/* ── 4b. Last contact backfill */}
      <div style={section}>
        <div style={sectionTitle}>Last contact backfill</div>
        <div style={sectionHelp}>
          New outbound calls and SMS automatically stamp <code>Person.lastContactedAt</code>. Use this
          to recompute the timestamp from history after a CSV import or to recover from a missed
          live update. Idempotent — safe to run repeatedly.
        </div>
        {lastContactedCounts && (
          <>
            <div style={row}>
              <span style={labelCol}>People with timestamp</span>
              <strong>{lastContactedCounts.withTimestamp}</strong>
            </div>
            <div style={row}>
              <span style={labelCol}>People without timestamp</span>
              <strong>{lastContactedCounts.withoutTimestamp}</strong>
            </div>
            <div style={row}>
              <span style={labelCol}>Total people</span>
              <strong>{lastContactedCounts.total}</strong>
            </div>
          </>
        )}
        {!lastContactedCounts && (
          <div style={{ fontSize: 12, color: 'var(--t-font-color-secondary)', marginBottom: 8 }}>
            Loading counters…
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            style={button(
              'primary',
              recomputing || lastContactedCounts?.total === 0,
            )}
            onClick={() => runRecompute()}
            disabled={recomputing || lastContactedCounts?.total === 0}
          >
            {recomputing ? 'Recomputing…' : 'Recompute from history'}
          </button>
          <button
            type="button"
            style={button('ghost', recomputing)}
            onClick={() => fetchLastContactedCounts()}
            disabled={recomputing}
          >
            Refresh counts
          </button>
          {recomputeResult && (
            <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)' }}>
              {recomputeResult}
            </span>
          )}
        </div>
      </div>

      {/* ── 5. Setup checklist */}
      <div style={section}>
        <div style={sectionTitle}>Quick setup checklist</div>
        <ol style={{ fontSize: 13, color: 'var(--t-font-color-primary)', paddingLeft: 20, margin: 0, lineHeight: 1.7 }}>
          <li>
            Get your Zadarma API key + secret from{' '}
            <a href="https://my.zadarma.com/marketplace/#tab-apiKeys" target="_blank" rel="noopener noreferrer" style={linkStyle}>
              Marketplace → API keys
            </a>
            {' '}and paste them into the <strong>Settings tab → ZADARMA_USER_KEY / ZADARMA_SECRET</strong>.
          </li>
          <li>
            Click <strong>Test connection</strong> above — should show your balance and direct numbers.
          </li>
          <li>
            Pick a <strong>Default sender DID</strong> in Behaviour above (auto-filled from your direct_numbers list).
          </li>
          <li>
            Open <a href="https://my.zadarma.com/marketplace/" target="_blank" rel="noopener noreferrer" style={linkStyle}>Marketplace → Notifications</a>:
            <ul style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.5 }}>
              <li><strong>Call notifications</strong> URL = PBX URL above. Enable events: <code style={{ fontFamily: 'monospace' }}>NOTIFY_END</code>, <code>NOTIFY_OUT_END</code>, <code>NOTIFY_RECORD</code>.</li>
              <li><strong>Event notifications</strong> URL = Events URL above. Enable events: <code>SMS</code>, <code>SPEECH_RECOGNITION</code>.</li>
              <li>Click <strong>Save</strong>, then Zadarma's own <strong>Test</strong> button to verify each URL is reachable.</li>
            </ul>
          </li>
          <li>
            Done. Open any Person with a phone number → click the Zadarma command in the top bar. Calls and SMS history appear, and the message box at the bottom sends SMS without leaving the page.
          </li>
        </ol>
      </div>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: ZADARMA_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Zadarma Settings',
  description: 'Custom Settings tab for the Zadarma App: connection status, friendly Behaviour controls, webhook URLs, and setup checklist.',
  component: ZadarmaSettings,
});
