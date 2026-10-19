import { useState, type ReactElement } from 'react';
import type { DiagnosticCheck } from '../../../shared/ipc.ts';
import { runNetworkDiagnostics } from '../diagnostics.ts';
import { uiStartup } from '../startup.ts';

/**
 * Settings → System → Connection check: one button that tells people (and
 * whoever helps them) why River cannot connect or why calls fail, in plain
 * words, with a report they can copy. Nothing in it is content or secret.
 */
export function ConnectionCheck(): ReactElement {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async (): Promise<void> => {
    setRunning(true);
    setCopied(false);
    try {
      const [main, ice] = await Promise.all([
        window.river.diagnostics.run(),
        window.river.voice.iceServers().catch(() => []),
      ]);
      const turn = ice.some((s) => s.urls.some((u) => u.startsWith('turn')));
      const ui = uiStartup.summary();
      setChecks([
        ...main,
        ...(ui ? [{ id: 'startup-ui', label: 'Start-up (window)', status: 'ok' as const, detail: ui }] : []),
        ...(await runNetworkDiagnostics(turn)),
      ]);
    } catch (err) {
      setChecks([{ id: 'error', label: 'Check', status: 'fail', detail: (err as Error).message }]);
    } finally {
      setRunning(false);
    }
  };

  const report = (): string =>
    [
      'River connection check',
      ...(checks ?? []).map(
        (c) =>
          `${{ ok: 'OK  ', warn: 'WARN', fail: 'FAIL' }[c.status]} ${c.label}: ${c.detail}${c.advice ? `\n     ${c.advice}` : ''}`,
      ),
    ].join('\n');

  return (
    <section className="conn-check" aria-labelledby="conn-check-title">
      <h3 id="conn-check-title" className="field__label">
        Connection check
      </h3>
      <p className="muted small">
        Can’t connect, or a call won’t work? Run this and send the report to whoever helps you.
      </p>
      <div className="linkrow">
        <button className="btn" onClick={() => void run()} disabled={running}>
          {running ? 'Checking…' : checks ? 'Check again' : 'Run connection check'}
        </button>
        {checks && (
          <button
            className="btn btn--ghost"
            onClick={() =>
              void navigator.clipboard.writeText(report()).then(() => {
                setCopied(true);
              })
            }
          >
            {copied ? 'Copied' : 'Copy report'}
          </button>
        )}
        <button className="btn btn--link" onClick={() => void window.river.diagnostics.openLogs()}>
          Open log folder
        </button>
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
