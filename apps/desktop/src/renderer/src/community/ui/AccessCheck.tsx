import { useState, type ReactElement } from 'react';
import { tr } from '../../i18n.ts';
import { explainPermission } from '../../../../shared/permission-explain.ts';
import type { ChannelView, CommunityView } from '../../../../shared/ipc.ts';
import { infoOf } from './CommunitySettings.tsx';

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
  return (
    <div className="access-check">
      <div className="field__label">{tr("Check someone's access here")}</div>
      <select aria-label={tr('Member to check')} value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">{tr('Choose a member…')}</option>
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
              tr,
            );
            return (
              <li key={bit} className={`access-check__item ${e.allowed ? 'is-yes' : 'is-no'}`}>
                <button
                  className="access-check__row"
                  aria-expanded={open === bit}
                  onClick={() => setOpen(open === bit ? null : bit)}
                >
                  <span aria-hidden="true">{e.allowed ? '✓' : '✕'}</span>
                  <span>{infoOf(bit).label}</span>
                  <span className="muted small">{e.allowed ? tr('can') : tr("can't")}</span>
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
      <p className="muted small">{tr('Includes changes you have not saved yet. Click a line to see why.')}</p>
    </div>
  );
}
