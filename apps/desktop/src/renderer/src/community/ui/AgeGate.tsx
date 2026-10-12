import { useState, type ReactElement } from 'react';
import type { ChannelView } from '../../../../shared/ipc.ts';
import { goBack } from '../../nav-history.ts';

const key = (channelId: string): string => `river.ageOk.${channelId}`;

export function ageConfirmed(channelId: string): boolean {
  try {
    return localStorage.getItem(key(channelId)) === '1';
  } catch {
    return false;
  }
}

/** Before opening an age-restricted channel (1.0.27): asked once per channel on this device. */
export function AgeGate({ channel, onOk }: { channel: ChannelView; onOk(): void }): ReactElement {
  const [busy] = useState(false);
  return (
    <div className="age-gate" role="region" aria-label="Age-restricted channel">
      <div className="age-gate__icon" aria-hidden="true">
        🔞
      </div>
      <h2>#{channel.name} is age-restricted</h2>
      <p className="muted">It may contain content for adults. Continue only if you are 18 or older.</p>
      <div className="age-gate__actions">
        <button className="btn btn--ghost" onClick={() => goBack()}>
          Go back
        </button>
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={() => {
            try {
              localStorage.setItem(key(channel.id), '1');
            } catch {
              // asked again next time
            }
            onOk();
          }}
        >
          I am 18 or older
        </button>
      </div>
    </div>
  );
}
