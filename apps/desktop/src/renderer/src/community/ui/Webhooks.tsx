import { useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { can } from './common.tsx';
import { rich, tr } from '../../i18n.ts';

/**
 * Community settings → Webhooks (1.0.32, ADR 0004). Outside services post with
 * a secret address and seal each post themselves, so the server still never
 * sees content.
 */
export function WebhooksPanel({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  // Only channels you may manage there: the server refuses webhooks anywhere else.
  const channels = community.channels.filter(
    (c) => c.kind === 'text' && !c.forum && can(c.permissions, Permission.MANAGE_CHANNELS),
  );
  const manages = (channelId: string): boolean =>
    community.channels.some((c) => c.id === channelId && can(c.permissions, Permission.MANAGE_CHANNELS));
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const active = (community.webhooks ?? []).filter((w) => !w.revoked);
  const who = (id: string): string =>
    community.members.find((m) => m.riverId === id)?.name ?? tr('Someone who left');
  const channelName = (id: string): string =>
    community.channels.find((c) => c.id === id)?.name ?? tr('deleted channel');

  const create = async (): Promise<void> => {
    if (!name.trim() || !channelId) return;
    const res = await s.run({ a: 'createWebhook', communityId: community.id, channelId, name: name.trim() });
    if (res) {
      setAddress(res);
      setCopied(false);
      setName('');
    }
  };

  return (
    <div className="settings-page">
      <h2>{tr('Webhooks')}</h2>
      <p className="muted small">
        {tr(
          'Let a script or another service post into a channel. It encrypts each post itself with a key that is only in the webhook address, so the server still cannot read it. Anyone with the address can post as the webhook (not read), so keep it secret.',
        )}
      </p>

      {address && (
        <div className="field" role="status">
          <strong>{tr('Copy this address now — River will not show it again.')}</strong>
          <div className="webhook-address">
            <code>{address}</code>
            <button
              className="btn btn--small"
              onClick={() => void navigator.clipboard.writeText(address).then(() => setCopied(true))}
            >
              {copied ? tr('Copied') : tr('Copy')}
            </button>
          </div>
          <p className="muted small">
            {rich(tr('Post with {script} from the River repository, or any tool that follows ADR 0004.'), {
              script: <code>scripts/webhook/post.mjs</code>,
            })}
          </p>
        </div>
      )}

      {channels.length === 0 ? (
        <p className="muted">
          {tr('Webhooks can post only in text channels you manage; there are none here for you.')}
        </p>
      ) : (
        <div className="row">
          <input
            aria-label={tr('Webhook name')}
            placeholder={tr('Name, e.g. Build bot')}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <select aria-label={tr('Channel')} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn--primary btn--small"
            disabled={!name.trim()}
            onClick={() => void create()}
          >
            {tr('Create webhook')}
          </button>
        </div>
      )}

      {active.length === 0 ? (
        <p className="muted">{tr('No webhooks yet.')}</p>
      ) : (
        <ul className="report-list">
          {active.map((w) => (
            <li key={w.id} className="report">
              <div className="report__head">
                <strong>{w.name}</strong>
                <span className="muted small">
                  {tr('posts in #{channel} · made by {name}', {
                    channel: channelName(w.channelId),
                    name: who(w.createdBy),
                  })}{' '}
                  · {new Date(w.createdAt).toLocaleDateString()}
                </span>
              </div>
              {manages(w.channelId) && (
                <div className="report__actions">
                  <button
                    className="btn btn--ghost btn--small btn--danger-text"
                    onClick={() =>
                      s.setModal({
                        kind: 'confirm',
                        title: tr('Delete {name}', { name: w.name }),
                        body: tr(
                          'Its address stops working at once; anything using it can no longer post. This cannot be undone.',
                        ),
                        action: tr('Delete webhook'),
                        run: async () => {
                          await s.run({ a: 'revokeWebhook', communityId: community.id, webhookId: w.id });
                        },
                        back: { kind: 'community-settings', communityId: community.id, tab: 'webhooks' },
                        then: { kind: 'community-settings', communityId: community.id, tab: 'webhooks' },
                      })
                    }
                  >
                    {tr('Delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
