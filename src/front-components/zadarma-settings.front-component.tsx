import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

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

const ZadarmaSettings = () => {
  const apiBaseUrl = useMemo(
    () => (process.env.TWENTY_API_URL ?? '').replace(/\/$/, ''),
    [],
  );
  const accessToken = process.env.TWENTY_APP_ACCESS_TOKEN;

  const pbxWebhookUrl = `${apiBaseUrl}/s/zadarma/pbx-webhook`;
  const eventWebhookUrl = `${apiBaseUrl}/s/zadarma-event-webhook`;

  const [info, setInfo] = useState<ZadarmaInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [pbxCheck, setPbxCheck] = useState<WebhookCheck>({ status: 'idle' });
  const [eventCheck, setEventCheck] = useState<WebhookCheck>({ status: 'idle' });

  const [appId, setAppId] = useState<string | null>(null);
  const [defaultSenderDid, setDefaultSenderDid] = useState<string>('');
  const [transcriptEnabled, setTranscriptEnabled] = useState<boolean>(true);
  const [savingVar, setSavingVar] = useState<string | null>(null);

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
      const did = vars.find((v) => v.key === 'DEFAULT_SENDER_DID')?.value ?? '';
      const tr = (vars.find((v) => v.key === 'ZADARMA_TRANSCRIPT_ENABLED')?.value ?? 'true').toLowerCase();
      setDefaultSenderDid(did);
      setTranscriptEnabled(tr !== 'false' && tr !== '0');
    } catch {
      // Non-fatal — sliders fall back to defaults; user can still use the
      // standard Settings tab to change values.
    }
  };

  useEffect(() => {
    refreshInfo();
    fetchAppVars();
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

  const copyText = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
  };

  // ── styles
  const container: CSSProperties = {
    padding: 24, display: 'flex', flexDirection: 'column', gap: 24, fontFamily: 'inherit',
  };
  const section: CSSProperties = {
    background: 'var(--t-background-primary)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', padding: 16,
  };
  const sectionTitle: CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--t-font-color-primary)' };
  const sectionHelp: CSSProperties = { fontSize: 12, color: 'var(--t-font-color-secondary)', marginBottom: 12, lineHeight: 1.5 };
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 };
  const labelCol: CSSProperties = { color: 'var(--t-font-color-secondary)', minWidth: 130 };
  const codeBox: CSSProperties = {
    flex: 1, fontFamily: 'monospace', fontSize: 12, background: 'var(--t-background-secondary)',
    padding: '4px 8px', borderRadius: 4, border: '1px solid var(--t-border-color-light)', wordBreak: 'break-all',
  };
  const button = (variant: 'primary' | 'ghost' = 'ghost', disabled = false): CSSProperties => ({
    padding: '4px 10px', fontSize: 12,
    border: variant === 'primary' ? 'none' : '1px solid rgba(0,0,0,0.15)',
    background: disabled ? '#cbd5e1' : (variant === 'primary' ? '#3b82f6' : 'white'),
    color: variant === 'primary' ? 'white' : '#111',
    borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 500,
  });
  const badge = (color: string): CSSProperties => ({
    padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 10,
    background: color, color: 'white', display: 'inline-block',
  });

  const checkBadge = (c: WebhookCheck) => {
    if (c.status === 'idle') return null;
    if (c.status === 'pending') return <span style={badge('#94a3b8')}>checking…</span>;
    if (c.status === 'ok') return <span style={badge('#16a34a')}>✓ ok</span>;
    return <span style={badge('#dc2626')}>✗ fail</span>;
  };

  const linkStyle: CSSProperties = { color: '#3b82f6', textDecoration: 'underline' };
  // Note: blue link colour stays hard-coded — readable on both light and dark
  // Twenty themes (#3b82f6 has solid contrast against both backgrounds).

  return (
    <div style={container}>
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
                <span style={{ ...badge('#ea580c'), marginLeft: 8 }}>low balance</span>
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

        <div style={row}>
          <span style={labelCol}>Default sender DID</span>
          {info?.numbers && info.numbers.length > 0 ? (
            <select
              value={defaultSenderDid}
              onChange={(e: { detail?: { value?: string } }) => {
                const next = e.detail?.value ?? '';
                setDefaultSenderDid(next);
                updateAppVar('DEFAULT_SENDER_DID', next);
              }}
              disabled={!appId || savingVar === 'DEFAULT_SENDER_DID'}
              style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
            >
              <option value="">— pick a number —</option>
              {info.numbers.map((n) => (
                <option key={n.number} value={n.number ?? ''}>
                  +{n.number} {n.description ? `· ${n.description}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={defaultSenderDid}
              placeholder="48573580808"
              onChange={(e: { detail?: { value?: string } }) => setDefaultSenderDid(e.detail?.value ?? '')}
              onBlur={() => updateAppVar('DEFAULT_SENDER_DID', defaultSenderDid)}
              disabled={!appId}
              style={{ flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
            />
          )}
          {savingVar === 'DEFAULT_SENDER_DID' && <span style={{ fontSize: 11, color: 'var(--t-font-color-secondary)' }}>saving…</span>}
        </div>

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
      </div>

      {/* ── 3. Webhook endpoints */}
      <div style={section}>
        <div style={sectionTitle}>Webhook endpoints</div>
        <div style={sectionHelp}>
          Paste these into <strong>Zadarma cabinet → Marketplace → Notifications</strong> (
          <a href="https://my.zadarma.com/marketplace/" target="_blank" rel="noopener noreferrer" style={linkStyle}>open</a>
          ): the "O połączeniach / Call notifications" URL field gets the PBX URL below; the
          "O zdarzeniach / Event notifications" URL field gets the Events URL.
          The Test buttons below ping each endpoint with a <code>zd_echo</code> handshake from your browser — green means
          the endpoint logic works. <strong>Important:</strong> Zadarma's own "Test" button in their cabinet pings from
          the public internet, so the URL must be publicly reachable. On localhost you need a tunnel
          (cloudflared / ngrok); on Coolify or any cloud Twenty install it works directly.
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={row}>
            <span style={labelCol}>PBX (calls)</span>
            <code style={codeBox}>{pbxWebhookUrl}</code>
            <button type="button" style={button('ghost')} onClick={() => copyText(pbxWebhookUrl)}>Copy</button>
            <button type="button" style={button('primary')} onClick={() => testWebhook(pbxWebhookUrl, setPbxCheck)}>Test</button>
            {checkBadge(pbxCheck)}
          </div>
          {pbxCheck.detail && <div style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 138 }}>{pbxCheck.detail}</div>}
        </div>

        <div>
          <div style={row}>
            <span style={labelCol}>Events (SMS)</span>
            <code style={codeBox}>{eventWebhookUrl}</code>
            <button type="button" style={button('ghost')} onClick={() => copyText(eventWebhookUrl)}>Copy</button>
            <button type="button" style={button('primary')} onClick={() => testWebhook(eventWebhookUrl, setEventCheck)}>Test</button>
            {checkBadge(eventCheck)}
          </div>
          {eventCheck.detail && <div style={{ fontSize: 11, color: 'var(--t-font-color-secondary)', marginLeft: 138 }}>{eventCheck.detail}</div>}
        </div>
      </div>

      {/* ── 4. Setup checklist */}
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
