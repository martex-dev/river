import { useState, type ReactElement } from 'react';
import type { DiagnosticCheck } from '../../../shared/ipc.ts';
import { TIMER_CHOICES } from '../../../shared/dm.ts';
import {
  HISTORY_DAY_CHOICES,
  proxySettingsSchema,
  type ProxySettings,
  type Settings,
} from '../../../shared/settings.ts';
import { useRiver } from '../store.ts';
import { msg, tr } from '../i18n.ts';
import { timerText } from '../time.ts';

const DAYS_LABEL: Record<number, string> = {
  0: msg('Keep them'),
  1: msg('1 day'),
  7: msg('1 week'),
  30: msg('30 days'),
  90: msg('90 days'),
  365: msg('1 year'),
};

/**
 * Settings → System → Privacy (2.15): what this device keeps, and (computers) a proxy for River's
 * connections. Everything said here is what main actually does (proxy.ts, dm-service.ts).
 */
export function PrivacySettings({ settings, phone }: { settings: Settings; phone: boolean }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const privacy = settings.privacy;
  return (
    <>
      <div className="two-col">
        <label className="textfield">
          <span className="field__label">{tr('Keep messages on this device')}</span>
          <select
            value={privacy.historyDays}
            onChange={(e) => void updateSettings({ privacy: { historyDays: Number(e.target.value) } })}
          >
            {HISTORY_DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {tr(DAYS_LABEL[d] ?? '')}
              </option>
            ))}
          </select>
        </label>
        <label className="textfield">
          <span className="field__label">{tr('Disappearing messages for new chats')}</span>
          <select
            value={privacy.newChatTimer}
            onChange={(e) => void updateSettings({ privacy: { newChatTimer: Number(e.target.value) } })}
          >
            {TIMER_CHOICES.map((t) => (
              <option key={t} value={t}>
                {timerText(t)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">
        {tr(
          'Direct and group messages older than you choose are deleted from this device. The people you talk to, and your other devices, keep their own copies. Community channels live on their server and are not affected. Chats you start from now on get the disappearing-messages timer; chats you already have keep theirs.',
        )}
      </p>
      {!phone && <ProxySettingsPanel current={privacy.proxy} />}
    </>
  );
}

function ProxySettingsPanel({ current }: { current: ProxySettings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const [draft, setDraft] = useState<ProxySettings>(
    current.mode === 'off' ? { ...current, mode: 'socks5' } : current,
  );
  const [portText, setPortText] = useState(String(draft.port));
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const on = current.mode !== 'off';

  const parsed = (): ProxySettings | null => {
    const result = proxySettingsSchema.safeParse({ ...draft, port: Number(portText) });
    if (result.success) return result.data;
    setError(tr(result.error.issues[0]?.message ?? 'Check the address and port'));
    return null;
  };
  const save = async (mode: ProxySettings['mode']): Promise<void> => {
    setError(null);
    const proxy = mode === 'off' ? { ...current, mode: 'off' as const } : parsed();
    if (!proxy) return;
    await updateSettings({ privacy: { proxy: mode === 'off' ? proxy : { ...proxy, mode } } });
  };
  const test = async (): Promise<void> => {
    setError(null);
    const proxy = parsed();
    if (!proxy) return;
    setBusy(true);
    try {
      setChecks(await window.river.privacy.checkProxy(proxy));
    } catch (err) {
      setChecks([{ id: 'error', label: tr('Test'), status: 'fail', detail: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  };
  const preset = (port: number): void => {
    setDraft({ mode: 'socks5', host: '127.0.0.1', port });
    setPortText(String(port));
    setChecks(null);
  };

  return (
    <section className="field" aria-labelledby="proxy-title">
      <h3 id="proxy-title" className="field__label">
        {tr('Connect through a proxy (Tor)')}
      </h3>
      <p className="muted small" role="status">
        {on
          ? tr('On: River connects to its server only through {kind} proxy {address}.', {
              kind: current.mode === 'socks5' ? 'SOCKS5' : 'HTTP',
              address: `${current.host}:${current.port}`,
            })
          : tr('Off: River connects to its server directly.')}
      </p>
      <p className="muted small">
        {tr(
          'What it hides: your IP address from your River server (and from the address relay and GitHub’s update checks). What it does not hide: your account, who you talk to and when — the server still sees that, and your messages were already end-to-end encrypted. While it is on, calls never connect directly: voice goes through a TURN relay or your server, so the people you call do not see your address either, and video or screen sharing work only if your server offers a TURN relay. Link previews are off. If the proxy stops, River does not connect at all — it never falls back to a direct connection. A server on this computer, and hosting from this PC, do not use the proxy. Computers only for now.',
        )}
      </p>
      <div className="linkrow">
        <button className="btn btn--ghost btn--small" onClick={() => preset(9050)}>
          Tor (9050)
        </button>
        <button className="btn btn--ghost btn--small" onClick={() => preset(9150)}>
          Tor Browser (9150)
        </button>
      </div>
      <div className="two-col">
        <label className="textfield">
          <span className="field__label">{tr('Type')}</span>
          <select
            value={draft.mode}
            onChange={(e) => setDraft({ ...draft, mode: e.target.value as ProxySettings['mode'] })}
          >
            <option value="socks5">SOCKS5 (Tor)</option>
            <option value="http">HTTP</option>
          </select>
        </label>
        <label className="textfield">
          <span className="field__label">{tr('Address')}</span>
          <input
            value={draft.host}
            onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            spellCheck={false}
            autoCapitalize="none"
            maxLength={253}
          />
        </label>
        <label className="textfield">
          <span className="field__label">{tr('Port')}</span>
          <input
            value={portText}
            inputMode="numeric"
            onChange={(e) => setPortText(e.target.value)}
            maxLength={5}
          />
        </label>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="linkrow">
        <button className="btn" onClick={() => void test()} disabled={busy}>
          {busy ? tr('Testing…') : tr('Test connection')}
        </button>
        <button className="btn btn--primary" onClick={() => void save(draft.mode)}>
          {on ? tr('Save') : tr('Turn on')}
        </button>
        {on && (
          <button className="btn btn--ghost" onClick={() => void save('off')}>
            {tr('Turn off')}
          </button>
        )}
      </div>
      {checks && (
        <ul className="conn-check__list" aria-live="polite">
          {checks.map((c) => (
            <li key={c.id} className={`conn-check__item conn-check__item--${c.status}`}>
              <span className="conn-check__mark" aria-label={c.status}>
                {c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✕'}
              </span>
              <span>
                <strong>{c.label}</strong> — {c.detail}
                {c.advice && <span className="conn-check__advice">{c.advice}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
