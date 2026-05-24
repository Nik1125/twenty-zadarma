import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { navigate } from 'twenty-sdk/front-component';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// Global SMS inbox (standalone page, reached from the left-nav "Zadarma
// Inbox" item). Messenger-style list of Persons whose latest inbound SMS is
// unanswered — newest on top. Click a row → open that Person (full record
// page, with the Zadarma chat tab). The ✓ button marks the thread read
// without replying. Data + model live server-side in inbox.logic-function.ts
// (GET /s/zadarma/inbox) and inbox-clear.logic-function.ts.

export const ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER =
  '0ca04ce8-7573-43c7-9794-6721542016eb';

type Thread = {
  personId: string;
  name: string;
  clientNumber: string | null;
  lastBody: string;
  lastAt: string;
  unreadCount: number;
};

const POLL_MS = 15_000;

// Two-tone notification chime (A5→E6, bell decay) as a self-contained WAV data
// URI — no external asset/network, no licensing. Played by re-mounting a
// declarative <audio autoPlay> element: the only path that works in the
// frontComponent sandbox (the Audio constructor is undefined in the worker
// realm; verified 2026-05-24). Swap the data URI to change the sound.
const BEEP =
  'data:audio/wav;base64,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';

const apiBase = (): string =>
  (process.env.TWENTY_API_URL ?? '').replace(/\/$/, '');

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ZadarmaInbox = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  // Installed id of the Person page's "Zadarma" tab, resolved once on mount so
  // a row click deep-links straight to the chat tab instead of Timeline. The
  // id is per-install (not portable), hence the server lookup.
  const [tabId, setTabId] = useState<string | null>(null);
  // Incremented to re-mount the <audio autoPlay> element → plays the beep.
  const [soundTick, setSoundTick] = useState(0);
  // Highest message timestamp (ms) seen so far. A higher one on a later poll
  // means a new inbound arrived → beep. null until the first load (no beep then).
  const prevMaxAtRef = useRef<number | null>(null);
  // Mirrors the ZADARMA_INBOX_SOUND setting; read once on mount (default on).
  const soundEnabledRef = useRef<boolean>(true);

  const fetchInbox = useCallback(async () => {
    const base = apiBase();
    const token = process.env.TWENTY_APP_ACCESS_TOKEN;
    if (!base || !token) {
      setError('App is not configured (missing API URL / access token).');
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`${base}/s/zadarma/inbox`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await r.json()) as {
        ok?: boolean;
        threads?: Thread[];
        error?: string;
      };
      if (!r.ok || json.ok === false) {
        setError(json.error ?? `HTTP ${r.status}`);
      } else {
        const list = json.threads ?? [];
        setThreads(list);
        setError(null);
        // Beep when a newer inbound appeared since the previous poll.
        const maxAt = list.reduce((m, t) => {
          const ms = Date.parse(t.lastAt);
          return Number.isNaN(ms) ? m : Math.max(m, ms);
        }, 0);
        if (
          prevMaxAtRef.current !== null &&
          maxAt > prevMaxAtRef.current &&
          soundEnabledRef.current
        ) {
          setSoundTick((s) => s + 1);
        }
        prevMaxAtRef.current =
          prevMaxAtRef.current === null
            ? maxAt
            : Math.max(prevMaxAtRef.current, maxAt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchInbox();
    const interval = setInterval(fetchInbox, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchInbox]);

  // Resolve the Zadarma tab id once on mount (stable until the next install).
  useEffect(() => {
    const base = apiBase();
    const token = process.env.TWENTY_APP_ACCESS_TOKEN;
    if (!base || !token) return;
    (async () => {
      try {
        const r = await fetch(`${base}/s/zadarma/inbox/tab-id`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await r.json()) as { tabId?: string | null };
        if (json.tabId) setTabId(json.tabId);
      } catch {
        // Non-fatal: without a tabId the click just opens the default tab.
      }
    })();
  }, []);

  // Read the ZADARMA_INBOX_SOUND setting once on mount (default on). Stored in
  // a ref so the polling closure always sees the current value.
  useEffect(() => {
    const base = apiBase();
    const token = process.env.TWENTY_APP_ACCESS_TOKEN;
    if (!base || !token) return;
    (async () => {
      try {
        const r = await fetch(`${base}/metadata`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: `query { findOneApplication(universalIdentifier: "${APPLICATION_UNIVERSAL_IDENTIFIER}") { applicationVariables { key value } } }`,
          }),
        });
        const json = (await r.json()) as {
          data?: {
            findOneApplication?: {
              applicationVariables?: Array<{ key?: string; value?: string }>;
            };
          };
        };
        const vars = json.data?.findOneApplication?.applicationVariables ?? [];
        const v = (
          vars.find((x) => x.key === 'ZADARMA_INBOX_SOUND')?.value ?? 'true'
        ).toLowerCase();
        soundEnabledRef.current = v !== 'false' && v !== '0';
      } catch {
        // Non-fatal: default to sound on.
      }
    })();
  }, []);

  const markRead = useCallback(
    async (personId: string) => {
      const base = apiBase();
      const token = process.env.TWENTY_APP_ACCESS_TOKEN;
      if (!base || !token) return;
      setClearing(personId);
      // Optimistic: drop the thread immediately so the UI feels instant.
      setThreads((prev) => prev.filter((t) => t.personId !== personId));
      try {
        await fetch(`${base}/s/zadarma/inbox/clear`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${token}`,
          },
          body: new URLSearchParams({ personId }).toString(),
        });
      } catch {
        // Re-sync on failure so a dropped thread reappears if the write failed.
        fetchInbox();
      } finally {
        setClearing(null);
      }
    },
    [fetchInbox],
  );

  // ── styles
  const container: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    color: 'var(--t-font-color-primary)',
  };
  const header: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--t-border-color-light)',
    fontSize: 14,
    fontWeight: 600,
  };
  const list: CSSProperties = {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  };
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderBottom: '1px solid var(--t-border-color-light)',
  };
  const rowMain: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: 'var(--t-font-color-primary)',
    padding: 0,
  };
  const nameLine: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
  };
  const snippet: CSSProperties = {
    fontSize: 12,
    color: 'var(--t-font-color-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const time: CSSProperties = {
    fontSize: 11,
    color: 'var(--t-font-color-tertiary)',
    fontWeight: 400,
    whiteSpace: 'nowrap',
  };
  const badge: CSSProperties = {
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    borderRadius: 10,
    background: 'var(--t-color-blue)',
    color: 'var(--t-font-color-inverted)',
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  const readBtn: CSSProperties = {
    border: '1px solid var(--t-border-color-medium)',
    background: 'var(--t-background-primary)',
    color: 'var(--t-font-color-secondary)',
    borderRadius: 6,
    fontSize: 12,
    padding: '4px 8px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
  const empty: CSSProperties = {
    color: 'var(--t-font-color-tertiary)',
    fontSize: 13,
    fontStyle: 'italic',
    padding: '40px 16px',
    textAlign: 'center',
  };

  return (
    <div style={container}>
      <div style={header}>
        <span>📨 Unanswered SMS</span>
        <span style={{ fontSize: 12, color: 'var(--t-font-color-secondary)', fontWeight: 400 }}>
          {threads.length || ''}
        </span>
      </div>
      {/* Plays once whenever a new inbound bumps soundTick (declarative — the
          worker realm has no Audio constructor). Gated by ZADARMA_INBOX_SOUND. */}
      {soundTick > 0 ? <audio key={soundTick} src={BEEP} autoPlay /> : null}

      {loading ? (
        <div style={empty}>Loading…</div>
      ) : error ? (
        <div style={{ ...empty, color: 'var(--t-font-color-danger)' }}>⚠ {error}</div>
      ) : threads.length === 0 ? (
        <div style={empty}>No unanswered messages. 🎉</div>
      ) : (
        <div style={list}>
          {threads.map((t) => (
            <div key={t.personId} style={row}>
              <button
                type="button"
                style={rowMain}
                onClick={() =>
                  navigate(
                    `/object/person/${t.personId}${tabId ? `#${tabId}` : ''}`,
                  )
                }
              >
                <div style={nameLine}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  <span style={time}>{formatDateTime(t.lastAt)}</span>
                </div>
                <div style={snippet}>{t.lastBody || '(empty message)'}</div>
              </button>
              <span style={badge}>{t.unreadCount}</span>
              <button
                type="button"
                style={readBtn}
                disabled={clearing === t.personId}
                onClick={() => markRead(t.personId)}
                title="Mark read — no reply needed"
              >
                {clearing === t.personId ? '…' : '✓'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: ZADARMA_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Zadarma Inbox',
  description:
    'Messenger-style feed of Persons with unanswered inbound SMS. Click to open the Person; ✓ marks read without replying.',
  component: ZadarmaInbox,
  // Second entry point (besides the standalone-page nav item) is a GLOBAL
  // pinned command that opens this feed in the right SIDE PANEL. It is NOT
  // declared here as a nested `command` — the SDK build leaves the top-level
  // manifest `commandMenuItems` array empty when the command is nested under a
  // frontComponent, so the server installs zero command items (verified: our
  // person-panel nested command is missing on local + Coolify for exactly this
  // reason). The command lives in its own defineCommandMenuItem manifest entry:
  // src/command-menu-items/zadarma-inbox.command-menu-item.ts.
});
