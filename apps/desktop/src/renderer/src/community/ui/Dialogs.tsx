import { msg, rich, tr, trn } from '../../i18n.ts';
import { AccessCheck } from './AccessCheck.tsx';
import { AvatarCropDialog, keepAnimated } from './AvatarCrop.tsx';
import { ForumSettings } from './Forum.tsx';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView } from '../../../../shared/ipc.ts';
import { play } from '../sound.ts';
import { useCommunity, type Modal as ModalState } from '../store.ts';
import { HashIcon, Modal, SpeakerIcon, Toggle, XIcon } from './common.tsx';
import { moveToCategory } from './ChannelList.tsx';
import { PermissionEditor, categoryPermissions, setOverwrite, type Overwrite } from './PermissionEditor.tsx';
import { useRiver } from '../../store.ts';

export function ConfirmDialog({ modal }: { modal: Extract<ModalState, { kind: 'confirm' }> }): ReactElement {
  const s = useCommunity();
  const [busy, setBusy] = useState(false);
  // Asked from a settings tab: Cancel goes back to it rather than closing everything.
  const back = (): void => s.setModal(modal.back ?? null);
  return (
    <Modal title={modal.title} onClose={back}>
      <p className="modal__text">{modal.body}</p>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={back}>
          {tr('Cancel')}
        </button>
        <button
          className="btn btn--danger"
          disabled={busy}
          autoFocus
          onClick={() => {
            setBusy(true);
            const before = useCommunity.getState().modal;
            void modal.run().finally(() => {
              // Close unless the action opened another dialog.
              if (useCommunity.getState().modal === before) s.setModal(modal.then ?? null);
            });
          }}
        >
          {modal.action}
        </button>
      </div>
    </Modal>
  );
}

const BAN_LENGTHS: Array<[number, string]> = [
  [0, msg('For good')],
  [3600, msg('For 1 hour')],
  [24 * 3600, msg('For 1 day')],
  [7 * 24 * 3600, msg('For 1 week')],
  [30 * 24 * 3600, msg('For 30 days')],
];

const BAN_DELETE_LABELS: Array<[number, string]> = [
  [0, msg("Don't delete any")],
  [3600, msg('From the last hour')],
  [6 * 3600, msg('From the last 6 hours')],
  [24 * 3600, msg('From the last 24 hours')],
  [3 * 24 * 3600, msg('From the last 3 days')],
  [7 * 24 * 3600, msg('From the last 7 days')],
];

/** Ban someone, optionally deleting their recent messages (1.0.21). */
export function BanDialog({ modal }: { modal: Extract<ModalState, { kind: 'ban' }> }): ReactElement {
  const s = useCommunity();
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const community = s.communities.find((c) => c.id === modal.communityId);
  const ban = async (): Promise<void> => {
    setBusy(true);
    const res = await s.run({
      a: 'ban',
      communityId: modal.communityId,
      riverId: modal.riverId,
      ...(seconds ? { deleteMessagesSeconds: seconds } : {}),
      ...(duration ? { durationSeconds: duration } : {}),
    });
    setBusy(false);
    s.setModal(modal.then ?? null);
    if (res !== null) s.notify(tr('{name} was banned.', { name: modal.name }));
  };
  return (
    <Modal title={tr('Ban {name}', { name: modal.name })} onClose={() => s.setModal(modal.then ?? null)}>
      <p className="modal__text">
        {community
          ? tr(
              '{name} will be removed from {community} and cannot rejoin until the ban ends or someone unbans them.',
              {
                name: modal.name,
                community: community.name,
              },
            )
          : tr(
              '{name} will be removed from the community and cannot rejoin until the ban ends or someone unbans them.',
              {
                name: modal.name,
              },
            )}
      </p>
      <label className="textfield">
        <span className="field__label">{tr('How long')}</span>
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {BAN_LENGTHS.map(([v, label]) => (
            <option key={v} value={v}>
              {tr(label)}
            </option>
          ))}
        </select>
      </label>
      <label className="textfield">
        <span className="field__label">{tr('Delete their messages')}</span>
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
          {BAN_DELETE_LABELS.map(([v, label]) => (
            <option key={v} value={v}>
              {tr(label)}
            </option>
          ))}
        </select>
      </label>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(modal.then ?? null)}>
          {tr('Cancel')}
        </button>
        <button className="btn btn--danger" disabled={busy} autoFocus onClick={() => void ban()}>
          {tr('Ban')}
        </button>
      </div>
    </Modal>
  );
}

export function InviteDialog({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void window.river.community.invite(community.id).then((res) => {
      if (res.ok) setInvite(res.value);
      else setError(res.message);
    });
  }, [community.id]);
  return (
    <Modal title={tr('Invite friends to {name}', { name: community.name })} onClose={() => s.setModal(null)}>
      <div className="invite-box">
        <p className="muted small">
          {tr(
            'Send this link privately. Anyone with it can join and read this community. It works 100 times and expires in 7 days.',
          )}
        </p>
        {error && <p className="field__error">{error}</p>}
        {!invite && !error && <p className="muted">{tr('Creating link…')}</p>}
        {invite && (
          <>
            <code className="invite-box__link">{invite}</code>
            <div className="button-row">
              <button
                className="btn btn--primary btn--small"
                onClick={() => {
                  void navigator.clipboard.writeText(invite).then(() => {
                    play('success');
                    setCopied(true);
                  });
                }}
              >
                {copied ? tr('Copied ✓') : tr('Copy link')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** A channel's name as saved: text channels lowercase with dashes for spaces ("game-night"). */
export function channelName(name: string, text: boolean): string {
  return text ? name.trim().toLowerCase().replace(/\s+/g, '-') : name.trim();
}

export function CreateChannelDialog(props: {
  community: CommunityView;
  kind: 'text' | 'voice';
  parentId?: string;
}): ReactElement {
  const s = useCommunity();
  const [kind, setKind] = useState<'text' | 'voice' | 'forum' | 'stage'>(props.kind);
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const cleaned = channelName(name, kind === 'text' || kind === 'forum');
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!cleaned.trim()) return;
    setBusy(true);
    await s.run({
      a: 'createChannel',
      communityId: props.community.id,
      kind: kind === 'voice' || kind === 'stage' ? 'voice' : 'text',
      ...(kind === 'forum' ? { forum: true } : {}),
      ...(kind === 'stage' ? { stage: true } : {}),
      name: cleaned.trim(),
      private: isPrivate,
      ...(props.parentId ? { parentId: props.parentId } : {}),
    });
    setBusy(false);
    s.setModal(null);
  };
  return (
    <Modal title={tr('Create channel')} onClose={() => s.setModal(null)}>
      <form onSubmit={(e) => void submit(e)} className="create-channel">
        <div className="field__label">{tr('Channel type')}</div>
        {(['text', 'voice', 'forum', 'stage'] as const).map((k) => (
          <label key={k} className={`kind-option ${kind === k ? 'is-active' : ''}`}>
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === 'text' ? (
              <HashIcon />
            ) : k === 'voice' ? (
              <SpeakerIcon />
            ) : (
              <span aria-hidden="true" style={{ fontSize: 20 }}>
                {k === 'forum' ? '🗂️' : '🎙️'}
              </span>
            )}
            <span>
              <strong>
                {k === 'text'
                  ? tr('Text')
                  : k === 'voice'
                    ? tr('Voice')
                    : k === 'forum'
                      ? tr('Forum')
                      : tr('Stage')}
              </strong>
              <span className="muted small">
                {k === 'text'
                  ? tr('Messages, emoji, opinions and puns')
                  : k === 'voice'
                    ? tr('Hang out with voice, video and screen share')
                    : k === 'forum'
                      ? tr('Organised posts with titles and tags, each with its own replies')
                      : tr('Talks and events: speakers on stage, everyone else listens')}
              </span>
            </span>
          </label>
        ))}
        <label className="textfield">
          <span className="field__label">{tr('Channel name')}</span>
          <input
            autoFocus
            value={name}
            maxLength={64}
            placeholder={tr('new-channel')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Toggle
          label={tr('Private channel')}
          help={tr('Only selected roles (and admins) will be able to see this channel.')}
          checked={isPrivate}
          onChange={setPrivate}
        />
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={() => s.setModal(null)}>
            {tr('Cancel')}
          </button>
          <button className="btn btn--primary" disabled={busy || cleaned.trim() === ''}>
            {tr('Create channel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Create a category; or edit one (name, permissions for its synced channels, delete). */
export function CategoryDialog(props: { community: CommunityView; categoryId?: string }): ReactElement {
  const s = useCommunity();
  const existing = props.community.categories.find((k) => k.id === props.categoryId);
  const [name, setName] = useState(existing?.name ?? '');
  const [overwrites, setOverwrites] = useState<Overwrite[]>(existing?.overwrites ?? []);
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  const [busy, setBusy] = useState(false);
  const me = useRiver((r) => r.identity?.riverId ?? '');
  const close = (): void => s.setModal(null);

  if (!existing) {
    const submit = async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      if (!name.trim()) return;
      setBusy(true);
      await s.run({ a: 'createCategory', communityId: props.community.id, name: name.trim() });
      setBusy(false);
      close();
    };
    return (
      <Modal title={tr('Create category')} onClose={close}>
        <form onSubmit={(e) => void submit(e)} className="create-channel">
          <label className="textfield">
            <span className="field__label">{tr('Category name')}</span>
            <input
              autoFocus
              value={name}
              maxLength={64}
              placeholder={tr('New category')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="muted small">
            {tr(
              'Category names are encrypted like channel names. Drag channels onto a category to move them.',
            )}
          </p>
          <div className="modal__foot">
            <button type="button" className="btn btn--link" onClick={close}>
              {tr('Cancel')}
            </button>
            <button className="btn btn--primary" disabled={busy || name.trim() === ''}>
              {tr('Create category')}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  const synced = props.community.channels.filter((c) => c.parentId === existing.id && c.synced);
  const dirtyName = name.trim() !== existing.name && name.trim() !== '';
  const dirtyPerms = JSON.stringify(overwrites) !== JSON.stringify(existing.overwrites);
  return (
    <Modal onClose={close} full>
      <div className="settings-layout">
        <nav className="settings-layout__nav" aria-label={tr('Category settings')}>
          <div className="settings-layout__heading">{existing.name}</div>
          <button
            className={`settings-tab ${tab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setTab('overview')}
          >
            {tr('Overview')}
          </button>
          <button
            className={`settings-tab ${tab === 'permissions' ? 'is-active' : ''}`}
            onClick={() => setTab('permissions')}
          >
            {tr('Permissions')}
          </button>
          <hr />
          <button
            className="settings-tab settings-tab--danger"
            onClick={() =>
              s.setModal({
                kind: 'confirm',
                title: tr('Delete {name}', { name: existing.name }),
                body: tr(
                  "Its channels stay and move out of the category. Channels synced to it keep the category's permissions as their own, so private channels stay private.",
                ),
                action: tr('Delete category'),
                run: async () => {
                  await s.run({
                    a: 'deleteCategory',
                    communityId: props.community.id,
                    categoryId: existing.id,
                  });
                },
                // Cancel keeps the category's settings open; once deleted there is nothing to show.
                back: { kind: 'category', communityId: props.community.id, categoryId: existing.id },
              })
            }
          >
            {tr('Delete category')}
          </button>
        </nav>
        <section className="settings-layout__body">
          <button
            className="settings-layout__close icon-btn"
            aria-label={tr('Close settings')}
            onClick={close}
          >
            <XIcon />
          </button>
          {tab === 'overview' && (
            <div className="settings-page">
              <h2>{tr('Overview')}</h2>
              <label className="textfield">
                <span className="field__label">{tr('Category name')}</span>
                <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              {dirtyName && (
                <div className="save-bar">
                  <span>{tr('Careful — you have unsaved changes!')}</span>
                  <button className="btn btn--link" onClick={() => setName(existing.name)}>
                    {tr('Reset')}
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() =>
                      void s.run({
                        a: 'renameCategory',
                        communityId: props.community.id,
                        categoryId: existing.id,
                        name: name.trim(),
                      })
                    }
                  >
                    {tr('Save changes')}
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === 'permissions' && (
            <div className="settings-page">
              <h2>{tr('Category permissions')}</h2>
              <p className="muted small">
                {synced.length
                  ? trn(
                      '{count} synced channels follow these permissions. Channels with their own permissions keep them.',
                      synced.length,
                    )
                  : tr(
                      'Channels you add to this category follow these permissions until you give them their own.',
                    )}
              </p>
              <PermissionEditor
                community={props.community}
                overwrites={overwrites}
                bits={CATEGORY_PERMS}
                mine={categoryPermissions(props.community, me, existing.overwrites)}
                saved={existing.overwrites}
                onChange={setOverwrites}
              />
              {dirtyPerms && (
                <div className="save-bar">
                  <span>{tr('Careful — you have unsaved changes!')}</span>
                  <button className="btn btn--link" onClick={() => setOverwrites(existing.overwrites)}>
                    {tr('Reset')}
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() =>
                      void s.run({
                        a: 'categoryPermissions',
                        communityId: props.community.id,
                        categoryId: existing.id,
                        overwrites,
                      })
                    }
                  >
                    {tr('Save changes')}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

const TEXT_PERMS = [
  Permission.VIEW_CHANNELS,
  Permission.SEND_MESSAGES,
  Permission.ADD_REACTIONS,
  Permission.ATTACH_FILES,
  Permission.MENTION_EVERYONE,
  Permission.MANAGE_MESSAGES,
  Permission.PIN_MESSAGES,
  Permission.MANAGE_CHANNELS,
];
const SLOWMODES: Array<[number, string]> = [
  [0, msg('Off')],
  [5, msg('5 seconds')],
  [10, msg('10 seconds')],
  [30, msg('30 seconds')],
  [60, msg('1 minute')],
  [120, msg('2 minutes')],
  [300, msg('5 minutes')],
  [600, msg('10 minutes')],
  [1800, msg('30 minutes')],
  [3600, msg('1 hour')],
  [7200, msg('2 hours')],
  [21600, msg('6 hours')],
];

/** A category's permissions cover both its text and voice channels. */
const CATEGORY_PERMS = [
  Permission.VIEW_CHANNELS,
  Permission.SEND_MESSAGES,
  Permission.ADD_REACTIONS,
  Permission.ATTACH_FILES,
  Permission.MENTION_EVERYONE,
  Permission.MANAGE_MESSAGES,
  Permission.PIN_MESSAGES,
  Permission.CONNECT,
  Permission.SPEAK,
  Permission.STREAM,
  Permission.MUTE_MEMBERS,
  Permission.MOVE_MEMBERS,
  Permission.MANAGE_CHANNELS,
];
const VOICE_PERMS = [
  Permission.VIEW_CHANNELS,
  Permission.CONNECT,
  Permission.SPEAK,
  Permission.STREAM,
  Permission.MUTE_MEMBERS,
  Permission.MOVE_MEMBERS,
  Permission.MANAGE_CHANNELS,
];

export function ChannelSettings(props: { community: CommunityView; channel: ChannelView }): ReactElement {
  const { community, channel } = props;
  const s = useCommunity();
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [overwrites, setOverwrites] = useState<Overwrite[]>(channel.overwrites);
  const close = (): void => s.setModal(null);
  const parent = community.categories.find((k) => k.id === channel.parentId);
  const dirtyOverview = name !== channel.name || topic !== channel.topic;
  const dirtyPerms = JSON.stringify(overwrites) !== JSON.stringify(channel.overwrites);
  const bits = channel.kind === 'text' ? TEXT_PERMS : VOICE_PERMS;
  const everyone = overwrites.find((o) => o.roleId === community.id);
  const isPrivate = !!everyone && (everyone.deny & Permission.VIEW_CHANNELS) !== 0;

  return (
    <Modal onClose={close} full>
      <div className="settings-layout">
        <nav className="settings-layout__nav" aria-label={tr('Channel settings')}>
          <div className="settings-layout__heading">
            {channel.kind === 'text' ? '#' : '🔊'} {channel.name}
          </div>
          <button
            className={`settings-tab ${tab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setTab('overview')}
          >
            {tr('Overview')}
          </button>
          <button
            className={`settings-tab ${tab === 'permissions' ? 'is-active' : ''}`}
            onClick={() => setTab('permissions')}
          >
            {tr('Permissions')}
          </button>
          <hr />
          <button
            className="settings-tab settings-tab--danger"
            onClick={() =>
              s.setModal({
                kind: 'confirm',
                title: tr('Delete {name}', { name: `${channel.kind === 'text' ? '#' : ''}${channel.name}` }),
                body: tr(
                  'This deletes the channel and all of its messages for everyone. This cannot be undone.',
                ),
                action: tr('Delete channel'),
                run: async () => {
                  await s.run({ a: 'deleteChannel', channelId: channel.id });
                },
                back: { kind: 'channel-settings', channelId: channel.id },
              })
            }
          >
            {tr('Delete channel')}
          </button>
        </nav>
        <section className="settings-layout__body">
          <button
            className="settings-layout__close icon-btn"
            aria-label={tr('Close settings')}
            onClick={close}
          >
            <XIcon />
          </button>
          {tab === 'overview' && (
            <div className="settings-page">
              <h2>{tr('Overview')}</h2>
              <label className="textfield">
                <span className="field__label">{tr('Channel name')}</span>
                <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              {channel.kind === 'text' && (
                <label className="textfield">
                  <span className="field__label">{tr('Channel topic')}</span>
                  <textarea
                    value={topic}
                    maxLength={300}
                    rows={3}
                    placeholder={tr('Let everyone know how to use this channel!')}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </label>
              )}
              {channel.kind === 'text' && (
                <>
                  <Toggle
                    label={tr('Age-restricted (18+)')}
                    help={tr('People confirm they are 18 or older before opening this channel.')}
                    checked={!!channel.nsfw}
                    onChange={(on) => void s.run({ a: 'updateChannel', channelId: channel.id, nsfw: on })}
                  />
                  <Toggle
                    label={tr('Media channel')}
                    help={tr(
                      'Opens as a gallery of the pictures and videos shared here; the chat is one click away.',
                    )}
                    checked={!!channel.media}
                    onChange={(on) => void s.run({ a: 'updateChannel', channelId: channel.id, media: on })}
                  />
                  <Toggle
                    label={tr('Forum')}
                    help={tr(
                      'Every message starts a post with a title and its own replies, shown as a list of posts.',
                    )}
                    checked={channel.forum}
                    onChange={(on) => void s.run({ a: 'updateChannel', channelId: channel.id, forum: on })}
                  />
                  {channel.forum && <ForumSettings channel={channel} />}
                  <Toggle
                    label={tr('Announcement channel')}
                    help={tr(
                      'Only people who can manage messages post here; everyone else reads and reacts.',
                    )}
                    checked={channel.announcement}
                    onChange={(on) =>
                      void s.run({ a: 'updateChannel', channelId: channel.id, announcement: on })
                    }
                  />
                  <label className="textfield">
                    <span className="field__label">{tr('Slowmode')}</span>
                    <select
                      value={channel.slowmode}
                      onChange={(e) =>
                        void s.run({
                          a: 'updateChannel',
                          channelId: channel.id,
                          slowmode: Number(e.target.value),
                        })
                      }
                    >
                      {SLOWMODES.map(([seconds, label]) => (
                        <option key={seconds} value={seconds}>
                          {tr(label)}
                        </option>
                      ))}
                    </select>
                    <span className="muted small">
                      {tr(
                        'How long members wait between messages. People who manage messages are not slowed down.',
                      )}
                    </span>
                  </label>
                </>
              )}
              {channel.kind === 'voice' && (
                <Toggle
                  label={tr('Stage')}
                  help={tr(
                    'For talks and events: people join as listeners, raise a hand to ask to speak, and moderators invite speakers.',
                  )}
                  checked={channel.stage}
                  onChange={(on) => void s.run({ a: 'updateChannel', channelId: channel.id, stage: on })}
                />
              )}
              {channel.kind === 'voice' && (
                <label className="textfield">
                  <span className="field__label">{tr('User limit')}</span>
                  <select
                    value={channel.userLimit}
                    onChange={(e) =>
                      void s.run({
                        a: 'updateChannel',
                        channelId: channel.id,
                        userLimit: Number(e.target.value),
                      })
                    }
                  >
                    {[0, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 99].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? tr('No limit') : trn('{count} people', n)}
                      </option>
                    ))}
                  </select>
                  <span className="muted small">{tr('People who can move members can always join.')}</span>
                </label>
              )}
              {community.categories.length > 0 && (
                <label className="textfield">
                  <span className="field__label">{tr('Category')}</span>
                  <select
                    value={channel.parentId ?? ''}
                    onChange={(e) => moveToCategory(community, channel.id, e.target.value || null)}
                  >
                    <option value="">{tr('No category')}</option>
                    {community.categories.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="field__label">{tr('Order')}</div>
              <div className="button-row">
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => void s.run({ a: 'moveChannel', channelId: channel.id, direction: -1 })}
                >
                  {tr('Move up')}
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => void s.run({ a: 'moveChannel', channelId: channel.id, direction: 1 })}
                >
                  {tr('Move down')}
                </button>
              </div>
              {dirtyOverview && (
                <div className="save-bar">
                  <span>{tr('Careful — you have unsaved changes!')}</span>
                  <button
                    className="btn btn--link"
                    onClick={() => {
                      setName(channel.name);
                      setTopic(channel.topic);
                    }}
                  >
                    {tr('Reset')}
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    disabled={name.trim() === ''}
                    onClick={() => {
                      // Text channels are named as when they were made (lowercase, dashes), so a
                      // renamed channel can still be #mentioned; the box shows what was saved.
                      const saved = channelName(name, channel.kind === 'text');
                      setName(saved);
                      void s.run({ a: 'updateChannel', channelId: channel.id, name: saved, topic });
                    }}
                  >
                    {tr('Save changes')}
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === 'permissions' && (
            <div className="settings-page">
              <h2>{tr('Channel permissions')}</h2>
              <p className="muted small">{tr('Override what each role can do in this channel only.')}</p>
              {parent && channel.synced && (
                <div className="sync-note" role="note">
                  🔗{' '}
                  {rich(
                    tr(
                      "Synced with {category}: this channel uses the category's permissions. Changing them here gives the channel its own.",
                    ),
                    { category: <strong>{parent.name}</strong> },
                  )}
                </div>
              )}
              {parent && !channel.synced && (
                <div className="sync-note sync-note--off" role="note">
                  {rich(tr('This channel has its own permissions, not those of {category}.'), {
                    category: <strong>{parent.name}</strong>,
                  })}
                  <button
                    className="btn btn--link btn--small"
                    onClick={() => void s.run({ a: 'updateChannel', channelId: channel.id, synced: true })}
                  >
                    {tr('Sync with category')}
                  </button>
                </div>
              )}
              <Toggle
                label={tr('Private channel')}
                help={tr('Hide this channel from @everyone. Then allow the roles that should see it.')}
                checked={isPrivate}
                onChange={(on) =>
                  setOverwrites(
                    setOverwrite(overwrites, community.id, Permission.VIEW_CHANNELS, on ? 'deny' : 'inherit'),
                  )
                }
              />
              <PermissionEditor
                community={community}
                overwrites={overwrites}
                bits={bits}
                mine={channel.permissions}
                saved={channel.overwrites}
                onChange={setOverwrites}
              />
              <AccessCheck community={community} channel={channel} overwrites={overwrites} bits={bits} />
              {dirtyPerms && (
                <div className="save-bar">
                  <span>{tr('Careful — you have unsaved changes!')}</span>
                  <button className="btn btn--link" onClick={() => setOverwrites(channel.overwrites)}>
                    {tr('Reset')}
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() => void s.run({ a: 'updateChannel', channelId: channel.id, overwrites })}
                  >
                    {tr('Save changes')}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** A picture for this community only (1.0.25). */
function CommunityAvatarField({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const set = (avatar: string | null): void =>
    void s.run({ a: 'setCommunityAvatar', communityId: community.id, avatar }).then((r) => {
      if (r !== null)
        s.notify(avatar ? tr('Picture set for this community.') : tr('Back to your usual picture here.'));
    });
  return (
    <div className="community-avatar">
      <span className="field__label">{tr('Picture in this community')}</span>
      <div className="community-avatar__row">
        {community.myCommunityAvatar ? (
          <img className="community-avatar__img" src={community.myCommunityAvatar} alt="" />
        ) : (
          <span className="muted small">{tr('Your usual picture')}</span>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={() => fileRef.current?.click()}>
          {tr('Choose…')}
        </button>
        {community.myCommunityAvatar && (
          <button type="button" className="btn btn--link btn--small" onClick={() => set(null)}>
            {tr('Use my usual picture')}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void keepAnimated(file).then((gif) => (gif ? set(gif) : setCropping(file)));
          }}
        />
        {cropping && (
          <AvatarCropDialog
            file={cropping}
            onClose={() => setCropping(null)}
            onDone={(avatar) => {
              setCropping(null);
              set(avatar);
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Your name in this community only; everyone else sees it here instead of your River name. */
export function NicknameDialog({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [nickname, setNickname] = useState(community.myNickname ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null): Promise<void> => {
    setBusy(true);
    await s.run({ a: 'setNickname', communityId: community.id, nickname: value });
    setBusy(false);
    s.setModal(null);
  };
  return (
    <Modal title={tr('Nickname in {name}', { name: community.name })} onClose={() => s.setModal(null)}>
      <form
        className="create-channel"
        onSubmit={(e) => {
          e.preventDefault();
          void save(nickname.trim() || null);
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Nickname')}</span>
          <input
            autoFocus
            value={nickname}
            maxLength={64}
            placeholder={tr('Your River name')}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <p className="muted small">
          {tr('Only members of this community see it. It is encrypted like the rest of your profile.')}
        </p>
        <CommunityAvatarField community={community} />
        <div className="modal__foot">
          {community.myNickname && (
            <button type="button" className="btn btn--link" disabled={busy} onClick={() => void save(null)}>
              {tr('Reset to my River name')}
            </button>
          )}
          <button type="button" className="btn btn--link" onClick={() => s.setModal(null)}>
            {tr('Cancel')}
          </button>
          <button className="btn btn--primary" disabled={busy}>
            {tr('Save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
