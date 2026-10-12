import { useState, type ReactElement } from 'react';
import { PERMISSION_INFO, Permission } from '@river/protocol/permissions';
import { explainPermission } from '../../../../shared/permission-explain.ts';
import type { ChannelView, CommunityView } from '../../../../shared/ipc.ts';

/**
 * Check someone's access in this channel, with the changes you have not
 * saved yet, and see why (1.0.26).
 */
export function AccessCheck(props: {
  community: CommunityView;
  channel: ChannelView;
  overwrites: ChannelView['overwrites'];
  bits: number[];
}): ReactElement {
  const { community, channel } = props;
  const [who, setWho] = useState<string>('');
  const [open, setOpen] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const member = community.members.find((m) => m.riverId === who);
  const labelOf = (bit: number): string =>
    PERMISSION_INFO.find((p) => Permission[p.key] === bit)?.label ?? 'Permission';
  return (
    <div className="access-check">
      <div className="field__label">Check someone&apos;s access here</div>
      <select aria-label="Member to check" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Choose a member…</option>
        {community.members.map((m) => (
          <option key={m.riverId} value={m.riverId}>
            {m.name}
          </option>
        ))}
      </select>
      {member && (
        <ul className="access-check__list">
          {props.bits.map((bit) => {
            const e = explainPermission(
              {
                ownerId: community.ownerId,
                everyoneRoleId: community.id,
                roles: community.roles,
                member: {
                  riverId: member.riverId,
                  roles: member.roles,
                  timedOut: !!member.timeoutUntil && Date.parse(member.timeoutUntil) > now,
                },
                channel: {
                  name: channel.name,
                  overwrites: props.overwrites,
                  announcement: channel.announcement,
                },
              },
              bit,
            );
            return (
              <li key={bit} className={`access-check__item ${e.allowed ? 'is-yes' : 'is-no'}`}>
                <button
                  className="access-check__row"
                  aria-expanded={open === bit}
                  onClick={() => setOpen(open === bit ? null : bit)}
                >
                  <span aria-hidden="true">{e.allowed ? '✓' : '✕'}</span>
                  <span>{labelOf(bit)}</span>
                  <span className="muted small">{e.allowed ? 'can' : "can't"}</span>
                </button>
                {open === bit && (
                  <ol className="access-check__why muted small">
                    {e.because.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small">Includes changes you have not saved yet. Click a line to see why.</p>
    </div>
  );
}
