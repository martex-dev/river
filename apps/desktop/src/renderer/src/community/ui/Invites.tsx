import { useEffect, useState, type ReactElement } from 'react';
import type { InviteView } from '../../../../shared/community-actions.ts';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { tr } from '../../i18n.ts';

/** Community settings → Invites (1.0.31): who made each invite, who joined with it, revoke. */
export function InvitesPanel({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [invites, setInvites] = useState<InviteView[] | null>(null);
  const load = (): void =>
    void s.run({ a: 'invites', communityId: community.id }).then((r) => setInvites(r ?? []));
  useEffect(load, [community.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = { kind: 'community-settings', communityId: community.id, tab: 'invites' } as const;
  const name = (id: string): string =>
    community.members.find((m) => m.riverId === id)?.name ?? tr('Someone who left');
  return (
    <div className="settings-page">
      <h2>{tr('Invites')}</h2>
      <p className="muted small">
        {tr(
          'Active invite links, who made them and who joined with them. Revoking stops a link from working; people who already joined stay.',
        )}
      </p>
      {invites === null && <p className="muted">{tr('Loading…')}</p>}
      {invites?.length === 0 && <p className="muted">{tr('No active invites.')}</p>}
      <ul className="report-list">
        {invites?.map((i) => (
          <li key={i.id} className="report">
            <div className="report__head">
              <strong>{i.createdByName}</strong>
              <span className="muted small">
                {tr('{uses} of {max} uses', { uses: i.uses, max: i.maxUses })} ·{' '}
                {tr('expires {date}', { date: new Date(i.expiresAt).toLocaleDateString() })}
                {i.createdAt
                  ? ` · ${tr('made {date}', { date: new Date(i.createdAt).toLocaleDateString() })}`
                  : ''}
              </span>
            </div>
            {i.joined.length > 0 && (
              <div className="muted small">
                {tr('Joined with it: {names}', { names: i.joined.map(name).join(', ') })}
              </div>
            )}
            <div className="report__actions">
              <button
                className="btn btn--ghost btn--small btn--danger-text"
                onClick={() =>
                  s.setModal({
                    kind: 'confirm',
                    title: tr('Revoke this invite?'),
                    body: tr(
                      'The link stops working at once for anyone who has not used it yet. People who joined with it stay. This cannot be undone.',
                    ),
                    action: tr('Revoke invite'),
                    run: async () => {
                      await s.run({ a: 'revokeInvite', communityId: community.id, inviteId: i.id });
                    },
                    back: here,
                    then: here,
                  })
                }
              >
                {tr('Revoke')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
