import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  defineFrontComponent,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';
import {
  navigate,
  useFrontComponentExecutionContext,
} from 'twenty-sdk/front-component';

// SDK 2.3.0 ships useRecordId() that blindly reads ctx.selectedRecordIds.length,
// but Twenty server <=2.2.x sends contexts that contain only the deprecated
// ctx.recordId field — no selectedRecordIds array. The result is an
// unhandled TypeError on every panel mount against older servers. This
// shim accepts either shape (preferring the newer array when present)
// and returns the same string | null contract as useRecordId.
const useRecordIdCompat = (): string | null =>
  useFrontComponentExecutionContext((ctx) => {
    const ctxAsRecord = ctx as unknown as {
      selectedRecordIds?: string[] | null;
      recordId?: string | null;
    };
    const ids = ctxAsRecord.selectedRecordIds;
    if (Array.isArray(ids) && ids.length === 1) return ids[0] ?? null;
    if (Array.isArray(ids) && ids.length > 1) return null;
    return ctxAsRecord.recordId ?? null;
  });
import { CoreApiClient } from 'twenty-client-sdk/core';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const ZADARMA_PERSON_PANEL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER =
  '637f472e-b67b-4174-bf75-68cadf496b1e';

type CallLogNode = {
  id: string;
  name: string | null;
  callType: 'IN' | 'OUT' | null;
  callStart: string | null;
  duration: number | null;
  disposition: string | null;
  ourNumber: string | null;
  internalExtension: string | null;
  callerType: 'HUMAN' | 'AI' | 'UNKNOWN' | null;
  aiAgentName: string | null;
};

type SmsLogNode = {
  id: string;
  body: string | null;
  direction: 'IN' | 'OUT' | null;
  sentAt: string | null;
  status: string | null;
  ourNumber: string | null;
};

type PersonNode = {
  id: string;
  phones: {
    primaryPhoneNumber: string | null;
    primaryPhoneCallingCode: string | null;
  } | null;
  doNotSms: boolean | null;
  doNotSmsAt: string | null;
  doNotSmsReason: string | null;
};

type Tab = 'calls' | 'sms';

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

const formatDuration = (sec: number | null): string => {
  if (!sec || sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// Returns a Twenty CSS theme token so call-disposition badges follow the
// active light/dark theme automatically.
const dispositionColor = (d: string | null): string => {
  switch (d) {
    case 'ANSWERED': return 'var(--t-color-green)';
    case 'NO_ANSWER': return 'var(--t-color-orange)';
    case 'BUSY': return 'var(--t-color-amber)';
    case 'CANCEL': return 'var(--t-color-gray)';
    case 'CALL_FAILED': return 'var(--t-color-red)';
    default: return 'var(--t-color-gray)';
  }
};

const dispositionLabel = (d: string | null): string => {
  switch (d) {
    case 'ANSWERED': return '✅ ANSWERED';
    case 'NO_ANSWER': return '🚫 NO_ANSWER';
    case 'BUSY': return '⏱ BUSY';
    case 'CANCEL': return '◯ CANCEL';
    case 'CALL_FAILED': return '⚠ CALL_FAILED';
    default: return 'unknown';
  }
};

const callerTypePill = (
  t: 'HUMAN' | 'AI' | 'UNKNOWN' | null,
): { label: string; color: string } | null => {
  if (t === 'AI') return { label: '🤖 AI', color: 'var(--t-color-purple)' };
  if (t === 'HUMAN') return { label: '👤 HUMAN', color: 'var(--t-color-gray)' };
  return null;
};

const pillStyle = (color: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  border: `1px solid ${color}`,
  color,
  whiteSpace: 'nowrap',
});

const ZadarmaPersonPanel = () => {
  const personId = useRecordIdCompat();
  const [tab, setTab] = useState<Tab>('sms');
  const [callLogs, setCallLogs] = useState<CallLogNode[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLogNode[]>([]);
  const [person, setPerson] = useState<PersonNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [defaultSenderDid, setDefaultSenderDid] = useState<string>('');

  const submitUrl = useMemo(() => {
    const apiBaseUrl = (process.env.TWENTY_API_URL ?? '').replace(/\/$/, '');
    return apiBaseUrl ? `${apiBaseUrl}/s/zadarma/send-sms` : null;
  }, []);

  // Pull the workspace's ZADARMA_DIDS once on mount and pick the first
  // entry (= the default DID) as the fallback sender when this Person has
  // no prior call/SMS history yet.
  useEffect(() => {
    const fetchDefaults = async () => {
      const apiBaseUrl = (process.env.TWENTY_API_URL ?? '').replace(/\/$/, '');
      const accessToken = process.env.TWENTY_APP_ACCESS_TOKEN;
      if (!apiBaseUrl || !accessToken) return;
      try {
        const r = await fetch(`${apiBaseUrl}/metadata`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            query: `query { findOneApplication(universalIdentifier: "${APPLICATION_UNIVERSAL_IDENTIFIER}") { applicationVariables { key value } } }`,
          }),
        });
        const json = (await r.json()) as {
          data?: { findOneApplication?: { applicationVariables?: Array<{ key?: string; value?: string }> } };
        };
        const vars = json.data?.findOneApplication?.applicationVariables ?? [];
        const didsRaw =
          vars.find((v) => v.key === 'ZADARMA_DIDS')?.value ?? '';
        const firstDid = didsRaw
          .split(',')
          .map((s) => s.replace(/\D+/g, ''))
          .find((d) => d.length >= 6);
        setDefaultSenderDid(firstDid ?? '');
      } catch {
        // Non-fatal — chat just falls back to history-derived ourNumber.
      }
    };
    fetchDefaults();
  }, []);

  // Compose the client phone in E.164 (no '+'). Twenty stores phones split —
  // we glue them back so it can be displayed and used for matching elsewhere.
  const clientNumber = useMemo(() => {
    const raw = person?.phones?.primaryPhoneNumber ?? '';
    const calling = (person?.phones?.primaryPhoneCallingCode ?? '').replace(/\D+/g, '');
    if (!raw) return '';
    if (calling && !raw.startsWith(calling)) return calling + raw.replace(/\D+/g, '');
    return raw.replace(/\D+/g, '');
  }, [person]);

  // Pick `ourNumber` from the most recent log entry, falling back to
  // DEFAULT_SENDER_DID applicationVariable so SMS sending works even on
  // Persons with no prior history.
  const lastOurNumber = useMemo(() => {
    const all: Array<{ ourNumber: string | null; ts: string | null }> = [
      ...smsLogs.map((s) => ({ ourNumber: s.ourNumber, ts: s.sentAt })),
      ...callLogs.map((c) => ({ ourNumber: c.ourNumber, ts: c.callStart })),
    ].filter((r) => r.ourNumber);
    all.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
    return all[0]?.ourNumber ?? defaultSenderDid;
  }, [smsLogs, callLogs, defaultSenderDid]);

  const isOptOut = person?.doNotSms === true;
  const hasSenderDid = lastOurNumber.trim().length > 0;

  const fetchData = async () => {
    if (personId === null) {
      setLoading(false);
      return;
    }
    const client = new CoreApiClient();

    const [personRes, callRes, smsRes] = await Promise.all([
      client.query({
        person: {
          __args: { filter: { id: { eq: personId } } },
          id: true,
          phones: { primaryPhoneNumber: true, primaryPhoneCallingCode: true },
          doNotSms: true,
          doNotSmsAt: true,
          doNotSmsReason: true,
        },
      }) as unknown as Promise<{ person: PersonNode | null }>,
      client.query({
        callLogs: {
          __args: { filter: { personId: { eq: personId } } },
          edges: {
            node: {
              id: true,
              name: true,
              callType: true,
              callStart: true,
              duration: true,
              disposition: true,
              ourNumber: true,
              internalExtension: true,
              callerType: true,
              aiAgentName: true,
            },
          },
        },
      }) as unknown as Promise<{ callLogs?: { edges?: Array<{ node: CallLogNode }> } }>,
      client.query({
        smsLogs: {
          __args: { filter: { personId: { eq: personId } } },
          edges: {
            node: {
              id: true,
              body: true,
              direction: true,
              sentAt: true,
              status: true,
              ourNumber: true,
            },
          },
        },
      }) as unknown as Promise<{ smsLogs?: { edges?: Array<{ node: SmsLogNode }> } }>,
    ]);

    setPerson(personRes.person ?? null);

    const callEdges = callRes.callLogs?.edges ?? [];
    const smsEdges = smsRes.smsLogs?.edges ?? [];
    const calls = callEdges.map((e) => e.node);
    const sms = smsEdges.map((e) => e.node);

    // Newest first for calls; oldest first for SMS so the chat reads top→bottom.
    calls.sort((a, b) => (b.callStart ?? '').localeCompare(a.callStart ?? ''));
    sms.sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''));

    setCallLogs(calls);
    setSmsLogs(sms);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    // Light polling so new inbound SMS / call records appear without manual refresh.
    const interval = setInterval(fetchData, 7000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);


  // Note: scrollIntoView isn't proxied through Twenty's Remote DOM bridge,
  // so we don't auto-scroll. Newest messages render at the bottom thanks to
  // chronological sort + flex column layout — user just scrolls if needed.

  // ── styles
  const container: CSSProperties = {
    display: 'flex', flexDirection: 'column', height: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit',
    // Anchor text colour for every descendant — Twenty's iframe body
    // colour isn't reliably inherited into <code>/<pre>/<span> children,
    // which made them disappear against dark-mode backgrounds.
    color: 'var(--t-font-color-primary)',
  };
  const tabsRow: CSSProperties = {
    display: 'flex', gap: 0, padding: '0 12px', borderBottom: '1px solid var(--t-border-color-light)',
  };
  const tabBtn = (active: boolean): CSSProperties => ({
    padding: '12px 16px', border: 'none', background: 'transparent',
    cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
    color: active ? 'var(--t-font-color-primary)' : 'var(--t-font-color-secondary)',
    borderBottom: active ? '2px solid var(--t-font-color-primary)' : '2px solid transparent',
  });
  const headerRow: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', background: 'var(--t-background-secondary)', fontSize: 12, color: 'var(--t-font-color-secondary)',
  };
  const empty: CSSProperties = {
    color: 'var(--t-font-color-tertiary)', fontSize: 13, fontStyle: 'italic',
    padding: '24px 12px', textAlign: 'center',
  };

  const callsList: CSSProperties = {
    flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
  };
  const callItem: CSSProperties = {
    padding: '10px 12px', background: 'var(--t-background-primary)', border: '1px solid var(--t-border-color-light)',
    borderRadius: 6, fontSize: 13, width: '100%', textAlign: 'left', cursor: 'pointer',
    fontFamily: 'inherit', color: 'var(--t-font-color-primary)',
    display: 'flex', flexDirection: 'column', gap: 4,
  };

  const messagesArea: CSSProperties = {
    flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
    background: 'var(--t-background-secondary)',
  };
  const bubble = (direction: 'IN' | 'OUT' | null): CSSProperties => ({
    alignSelf: direction === 'OUT' ? 'flex-end' : 'flex-start',
    maxWidth: '80%',
    padding: '8px 12px',
    background: direction === 'OUT' ? 'var(--t-color-blue)' : 'var(--t-background-primary)',
    color: direction === 'OUT' ? 'var(--t-font-color-inverted)' : 'var(--t-font-color-primary)',
    border: direction === 'OUT' ? 'none' : '1px solid var(--t-border-color-light)',
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  });
  const meta: CSSProperties = {
    fontSize: 10, opacity: 0.6, marginTop: 4,
  };

  if (loading) return <div style={empty}>Loading…</div>;

  const renderCalls = () => (
    <>
      <div style={headerRow}>
        <span>{callLogs.length} call{callLogs.length === 1 ? '' : 's'}</span>
        {clientNumber && (
          <span style={{ fontSize: 11, color: 'var(--t-font-color-tertiary)' }}>+{clientNumber}</span>
        )}
      </div>
      <div style={callsList}>
        {callLogs.length === 0 ? (
          <div style={empty}>No calls linked to this person yet</div>
        ) : (
          callLogs.map((c) => {
            const caller = callerTypePill(c.callerType);
            const showDuration = typeof c.duration === 'number' && c.duration > 0;
            return (
              <button
                type="button"
                key={c.id}
                style={callItem}
                onClick={() => navigate(`/object/callLog/${c.id}`)}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    rowGap: 4,
                    columnGap: 8,
                    alignItems: 'center',
                    fontSize: 12,
                  }}
                >
                  <strong style={{ fontSize: 12 }}>
                    {c.callType === 'IN' ? '📥 Inbound' : '📤 Outbound'}
                  </strong>
                  <span style={{ color: 'var(--t-font-color-secondary)' }}>
                    · {formatDateTime(c.callStart)}
                  </span>
                  <span style={pillStyle(dispositionColor(c.disposition))}>
                    {dispositionLabel(c.disposition)}
                  </span>
                  {showDuration && (
                    <span style={{ color: 'var(--t-font-color-secondary)' }}>
                      {formatDuration(c.duration)}
                    </span>
                  )}
                  {caller && (
                    <span style={pillStyle(caller.color)}>{caller.label}</span>
                  )}
                  {c.internalExtension && (
                    <span style={{ color: 'var(--t-font-color-secondary)' }}>
                      ext {c.internalExtension}
                    </span>
                  )}
                </div>
                {c.aiAgentName && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--t-font-color-secondary)',
                      paddingLeft: 4,
                    }}
                  >
                    {c.aiAgentName}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </>
  );

  const renderSms = () => (
    <>
      <div style={messagesArea}>
        {smsLogs.length === 0 ? (
          <div style={empty}>No messages yet</div>
        ) : (
          smsLogs.map((s) => (
            <div key={s.id} style={bubble(s.direction)}>
              <div>{s.body ?? ''}</div>
              <div style={meta}>
                {formatDateTime(s.sentAt)}
                {s.direction === 'OUT' && s.status && ` · ${s.status.toLowerCase()}`}
              </div>
            </div>
          ))
        )}
      </div>
      {submitUrl && clientNumber ? (
        <div style={{
          display: 'flex', flexDirection: 'column',
          background: 'var(--t-background-primary)',
          borderTop: '1px solid var(--t-border-color-light)',
        }}>
          {isOptOut && person ? (
            <div style={{
              padding: '10px 12px',
              background: 'var(--t-background-transparent-orange)',
              fontSize: 12,
              color: 'var(--t-font-color-primary)',
              borderBottom: '1px solid var(--t-border-color-light)',
              lineHeight: 1.4,
            }}>
              <span style={{ fontWeight: 600 }}>SMS sending blocked. </span>
              <span>
                Contact opted out of SMS
                {person.doNotSmsAt ? ' on ' + formatDateTime(person.doNotSmsAt) : ''}
                .
              </span>
              {person.doNotSmsReason ? (
                <div style={{ marginTop: 4, color: 'var(--t-font-color-secondary)', fontStyle: 'italic' }}>
                  Reason: {person.doNotSmsReason}
                </div>
              ) : null}
            </div>
          ) : null}
          {!isOptOut && !hasSenderDid ? (
            <div style={{
              padding: '10px 12px',
              background: 'var(--t-background-transparent-orange)',
              fontSize: 12,
              color: 'var(--t-font-color-primary)',
              borderBottom: '1px solid var(--t-border-color-light)',
              lineHeight: 1.4,
            }}>
              <span style={{ fontWeight: 600 }}>No sender number. </span>
              <span>
                Set <code>ZADARMA_DIDS</code> in Settings → Zadarma → Behaviour by ticking at least one number. The first ticked entry is the default sender. Sending is disabled until a sender number is configured.
              </span>
            </div>
          ) : null}
          <div style={{
            display: 'flex', gap: 8, padding: 12, alignItems: 'flex-end',
          }}>
          {/* Controlled textarea. Worker reads typed text via `e.detail.value`
              (custom-element CustomEvent dispatched by remote-dom — see
              feedback_twenty_app_sdk_2_2_quirks memory).
              Auto-grow: rows scales with newline count up to 4, then scrolls.
              We cannot measure visual wrap from the worker (no DOM access),
              so the heuristic counts hard newlines only — wrapped long lines
              just expand the scrollbar inside the same row. */}
          <textarea
            placeholder={isOptOut ? 'Sending disabled — contact opted out' : !hasSenderDid ? 'Sending disabled — no sender DID' : 'Type a message…'}
            value={messageText}
            rows={Math.min(4, Math.max(1, messageText.split('\n').length))}
            onChange={(e: { detail?: { value?: string } }) => {
              setMessageText(e.detail?.value ?? '');
            }}
            onInput={(e: { detail?: { value?: string } }) => {
              setMessageText(e.detail?.value ?? '');
            }}
            disabled={sending || isOptOut || !hasSenderDid}
            style={{
              flex: 1, padding: '8px 12px',
              border: '1px solid var(--t-border-color-medium)',
              borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none',
              background: 'var(--t-background-primary)',
              color: 'var(--t-font-color-primary)',
              lineHeight: 1.4, resize: 'none',
              opacity: sending || isOptOut || !hasSenderDid ? 0.6 : 1,
            }}
          />
          <button
            type="button"
            disabled={sending || isOptOut || !hasSenderDid || !messageText.trim()}
            onClick={async () => {
              setSendError(null);
              setSending(true);
              try {
                const body = new URLSearchParams({
                  to: clientNumber,
                  from: lastOurNumber,
                  message: messageText,
                  personId: personId ?? '',
                  source: 'CHAT_PANEL',
                }).toString();
                const accessToken = process.env.TWENTY_APP_ACCESS_TOKEN;
                const r = await fetch(submitUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                  },
                  body,
                });
                const text = await r.text();
                let json: { ok?: boolean; error?: string; zadarmaMessage?: string } | null = null;
                try { json = JSON.parse(text); } catch { /* upstream may return non-JSON */ }
                if (!r.ok || (json && json.ok === false)) {
                  setSendError(json?.error ?? json?.zadarmaMessage ?? `HTTP ${r.status}`);
                } else {
                  setMessageText('');
                  // Trigger immediate refresh so the new smsLog appears without
                  // waiting for the 7s polling interval.
                  fetchData();
                }
              } catch (err) {
                setSendError(err instanceof Error ? err.message : String(err));
              } finally {
                setSending(false);
              }
            }}
            style={{
              padding: '8px 16px', border: 'none',
              background: sending || isOptOut || !hasSenderDid || !messageText.trim() ? 'var(--t-background-tertiary)' : 'var(--t-color-blue)',
              color: 'var(--t-font-color-inverted)', borderRadius: 6,
              cursor: sending || isOptOut || !hasSenderDid || !messageText.trim() ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 500,
            }}
          >
            {sending ? '…' : 'Send'}
          </button>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '10px 12px',
          background: 'var(--t-background-transparent-orange)',
          fontSize: 11,
          color: 'var(--t-font-color-secondary)',
          borderTop: '1px solid var(--t-border-color-light)',
          lineHeight: 1.5,
        }}>
          💡 {!clientNumber
            ? 'Add a phone number to this person to enable SMS sending.'
            : 'SMS endpoint is unreachable. Check that the Zadarma App is installed and the Twenty server URL is correct.'}
        </div>
      )}
      {sendError && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--t-background-transparent-danger)',
          borderTop: '1px solid var(--t-border-color-danger)',
          fontSize: 11,
          color: 'var(--t-font-color-danger)',
        }}>
          ⚠ {sendError}
        </div>
      )}
    </>
  );

  return (
    <div style={container}>
      <div style={tabsRow}>
        <button type="button" style={tabBtn(tab === 'sms')} onClick={() => setTab('sms')}>
          SMS ({smsLogs.length})
        </button>
        <button type="button" style={tabBtn(tab === 'calls')} onClick={() => setTab('calls')}>
          Calls ({callLogs.length})
        </button>
      </div>
      {tab === 'sms' ? renderSms() : renderCalls()}
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: ZADARMA_PERSON_PANEL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Zadarma Person Panel',
  description: 'Shows Zadarma SMS chat and call history for the current person; allows sending SMS and click-to-call',
  component: ZadarmaPersonPanel,
  command: {
    universalIdentifier: '76967346-b7af-422d-829a-85b29e0eb1a0',
    label: 'Zadarma',
    icon: 'IconPhone',
    isPinned: true,
    availabilityType: 'GLOBAL_OBJECT_CONTEXT',
    availabilityObjectUniversalIdentifier:
      STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  },
});
