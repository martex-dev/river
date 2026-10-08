import type { ReactElement } from 'react';
import type { IdentityInfo } from '../../../shared/ipc.ts';

/** Fingerprint in hex and as Bytewords, laid out for reading aloud. */
export function IdentityFingerprint({ identity }: { identity: IdentityInfo }): ReactElement {
  const groups = identity.fingerprint.split(' ');
  return (
    <div className="fingerprint">
      <div className="fingerprint__hex mono" aria-label={`Fingerprint ${identity.fingerprint}`}>
        <span>{groups.slice(0, 4).join(' ')}</span>
        <span>{groups.slice(4).join(' ')}</span>
      </div>
      <ol className="fingerprint__words" aria-label="Verification words">
        {identity.words.map((w, i) => (
          <li key={i} style={{ animationDelay: `${i * 35}ms` }}>
            <span className="fingerprint__n mono">{String(i + 1).padStart(2, '0')}</span>
            {w}
          </li>
        ))}
      </ol>
    </div>
  );
}
