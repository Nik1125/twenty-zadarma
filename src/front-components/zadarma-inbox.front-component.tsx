import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { navigate } from 'twenty-sdk/front-component';

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
        setThreads(json.threads ?? []);
        setError(null);
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
                onClick={() => navigate(`/object/person/${t.personId}`)}
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
