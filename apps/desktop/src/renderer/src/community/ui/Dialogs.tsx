import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity, type Modal as ModalState } from '../store.ts';
import { HashIcon, Modal, SpeakerIcon, Toggle, XIcon, hex } from './common.tsx';
import { moveToCategory } from './ChannelList.tsx';
import { infoOf } from './CommunitySettings.tsx';

export function ConfirmDialog({ modal }: { modal: Extract<ModalState, { kind: 'confirm' }> }): ReactElement {
  const s = useCommunity();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={modal.title} onClose={() => s.setModal(null)}>
      <p className="modal__text">{modal.body}</p>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          Cancel
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
              if (useCommunity.getState().modal === before) s.setModal(null);
            });
          }}
        >
          {modal.action}
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
    <Modal title={`Invite friends to ${community.name}`} onClose={() => s.setModal(null)}>
      <div className="invite-box">
        <p className="muted small">
          Send this link privately. Anyone with it can join and read this community. It works 100 times and
          expires in 7 days.
        </p>
        {error && <p className="field__error">{error}</p>}
        {!invite && !error && <p className="muted">Creating link…</p>}
        {invite && (
          <>
            <code className="invite-box__link">{invite}</code>
            <div className="button-row">
              <button
                className="btn btn--primary btn--small"
                onClick={() => {
                  void navigator.clipboard.writeText(invite).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function CreateChannelDialog(props: {
  community: CommunityView;
  kind: 'text' | 'voice';
  parentId?: string;
}): ReactElement {
  const s = useCommunity();
  const [kind, setKind] = useState(props.kind);
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const cleaned = kind === 'text' ? name.toLowerCase().replace(/\s+/g, '-') : name;
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!cleaned.trim()) return;
    setBusy(true);
    await s.run({
      a: 'createChannel',
      communityId: props.community.id,
      kind,
      name: cleaned.trim(),
      private: isPrivate,
      ...(props.parentId ? { parentId: props.parentId } : {}),
    });
    setBusy(false);
    s.setModal(null);
  };
  return (
    <Modal title="Create channel" onClose={() => s.setModal(null)}>
      <form onSubmit={(e) => void submit(e)} className="create-channel">
        <div className="field__label">Channel type</div>
        {(['text', 'voice'] as const).map((k) => (
          <label key={k} className={`kind-option ${kind === k ? 'is-active' : ''}`}>
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === 'text' ? <HashIcon /> : <SpeakerIcon />}
            <span>
              <strong>{k === 'text' ? 'Text' : 'Voice'}</strong>
              <span className="muted small">
                {k === 'text'
                  ? 'Messages, emoji, opinions and puns'
                  : 'Hang out with voice, video and screen share'}
              </span>
            </span>
          </label>
        ))}
        <label className="textfield">
          <span className="field__label">Channel name</span>
          <input
            autoFocus
            value={name}
            maxLength={64}
            placeholder="new-channel"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Toggle
          label="Private channel"
          help="Only selected roles (and admins) will be able to see this channel."
          checked={isPrivate}
          onChange={setPrivate}
        />
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={() => s.setModal(null)}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled={busy || cleaned.trim() === ''}>
            Create channel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Create a category, or rename or delete one. */
export function CategoryDialog(props: { community: CommunityView; categoryId?: string }): ReactElement {
  const s = useCommunity();
  const existing = props.community.categories.find((k) => k.id === props.categoryId);
  const [name, setName] = useState(existing?.name ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await s.run(
      existing
        ? { a: 'renameCategory', communityId: props.community.id, categoryId: existing.id, name: name.trim() }
        : { a: 'createCategory', communityId: props.community.id, name: name.trim() },
    );
    setBusy(false);
    s.setModal(null);
  };
  return (
    <Modal title={existing ? 'Edit category' : 'Create category'} onClose={() => s.setModal(null)}>
      <form onSubmit={(e) => void submit(e)} className="create-channel">
        <label className="textfield">
          <span className="field__label">Category name</span>
          <input
            autoFocus
            value={name}
            maxLength={64}
            placeholder="New category"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="muted small">
          Category names are encrypted like channel names. Drag channels onto a category to move them.
        </p>
        <div className="modal__foot">
          {existing && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() =>
                s.setModal({
                  kind: 'confirm',
                  title: `Delete ${existing.name}`,
                  body: 'Its channels stay; they just move out of the category.',
                  action: 'Delete category',
                  run: async () => {
                    await s.run({
                      a: 'deleteCategory',
                      communityId: props.community.id,
                      categoryId: existing.id,
                    });
                  },
                })
              }
            >
              Delete
            </button>
          )}
          <button type="button" className="btn btn--link" onClick={() => s.setModal(null)}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled={busy || name.trim() === ''}>
            {existing ? 'Save' : 'Create category'}
          </button>
        </div>
      </form>
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
const VOICE_PERMS = [
  Permission.VIEW_CHANNELS,
  Permission.CONNECT,
  Permission.SPEAK,
  Permission.STREAM,
  Permission.MUTE_MEMBERS,
  Permission.MOVE_MEMBERS,
  Permission.MANAGE_CHANNELS,
];

type Overwrite = ChannelView['overwrites'][number];

export function ChannelSettings(props: { community: CommunityView; channel: ChannelView }): ReactElement {
  const { community, channel } = props;
  const s = useCommunity();
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [overwrites, setOverwrites] = useState<Overwrite[]>(channel.overwrites);
  const [role, setRole] = useState(community.id);
  const close = (): void => s.setModal(null);
  const dirtyOverview = name !== channel.name || topic !== channel.topic;
  const dirtyPerms = JSON.stringify(overwrites) !== JSON.stringify(channel.overwrites);
  const bits = channel.kind === 'text' ? TEXT_PERMS : VOICE_PERMS;
  const everyone = overwrites.find((o) => o.roleId === community.id);
  const isPrivate = !!everyone && (everyone.deny & Permission.VIEW_CHANNELS) !== 0;

  const setBit = (roleId: string, bit: number, value: 'allow' | 'deny' | 'inherit'): void => {
    const current = overwrites.find((o) => o.roleId === roleId) ?? { roleId, allow: 0, deny: 0 };
    const next = {
      roleId,
      allow: value === 'allow' ? current.allow | bit : current.allow & ~bit,
      deny: value === 'deny' ? current.deny | bit : current.deny & ~bit,
    };
    const rest = overwrites.filter((o) => o.roleId !== roleId);
    setOverwrites(next.allow || next.deny ? [...rest, next] : rest);
  };
  const stateOf = (roleId: string, bit: number): 'allow' | 'deny' | 'inherit' => {
    const o = overwrites.find((x) => x.roleId === roleId);
    if (o && o.allow & bit) return 'allow';
    if (o && o.deny & bit) return 'deny';
    return 'inherit';
  };
  const selectedRole = community.roles.find((r) => r.id === role) ?? community.roles.find((r) => r.everyone)!;

  return (
    <Modal onClose={close} full>
      <div className="settings-layout">
        <nav className="settings-layout__nav" aria-label="Channel settings">
          <div className="settings-layout__heading">
            {channel.kind === 'text' ? '#' : '🔊'} {channel.name}
          </div>
          <button
            className={`settings-tab ${tab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            className={`settings-tab ${tab === 'permissions' ? 'is-active' : ''}`}
            onClick={() => setTab('permissions')}
          >
            Permissions
          </button>
          <hr />
          <button
            className="settings-tab settings-tab--danger"
            onClick={() =>
              s.setModal({
                kind: 'confirm',
                title: `Delete ${channel.kind === 'text' ? '#' : ''}${channel.name}`,
                body: 'This deletes the channel and all of its messages for everyone. This cannot be undone.',
                action: 'Delete channel',
                run: async () => {
                  await s.run({ a: 'deleteChannel', channelId: channel.id });
                },
              })
            }
          >
            Delete channel
          </button>
        </nav>
        <section className="settings-layout__body">
          <button className="settings-layout__close icon-btn" aria-label="Close settings" onClick={close}>
            <XIcon />
          </button>
          {tab === 'overview' && (
            <div className="settings-page">
              <h2>Overview</h2>
              <label className="textfield">
                <span className="field__label">Channel name</span>
                <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              {channel.kind === 'text' && (
                <label className="textfield">
                  <span className="field__label">Channel topic</span>
                  <textarea
                    value={topic}
                    maxLength={300}
                    rows={3}
                    placeholder="Let everyone know how to use this channel!"
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </label>
              )}
              {community.categories.length > 0 && (
                <label className="textfield">
                  <span className="field__label">Category</span>
                  <select
                    value={channel.parentId ?? ''}
                    onChange={(e) => moveToCategory(community, channel.id, e.target.value || null)}
                  >
                    <option value="">No category</option>
                    {community.categories.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="field__label">Order</div>
              <div className="button-row">
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => void s.run({ a: 'moveChannel', channelId: channel.id, direction: -1 })}
                >
                  Move up
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => void s.run({ a: 'moveChannel', channelId: channel.id, direction: 1 })}
                >
                  Move down
                </button>
              </div>
              {dirtyOverview && (
                <div className="save-bar">
                  <span>Careful — you have unsaved changes!</span>
                  <button
                    className="btn btn--link"
                    onClick={() => {
                      setName(channel.name);
                      setTopic(channel.topic);
                    }}
                  >
                    Reset
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    disabled={name.trim() === ''}
                    onClick={() =>
                      void s.run({ a: 'updateChannel', channelId: channel.id, name: name.trim(), topic })
                    }
                  >
                    Save changes
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === 'permissions' && (
            <div className="settings-page">
              <h2>Channel permissions</h2>
              <p className="muted small">Override what each role can do in this channel only.</p>
              <Toggle
                label="Private channel"
                help="Hide this channel from @everyone. Then allow the roles that should see it."
                checked={isPrivate}
                onChange={(on) => setBit(community.id, Permission.VIEW_CHANNELS, on ? 'deny' : 'inherit')}
              />
              <div className="overwrites">
                <div className="overwrites__roles">
                  <div className="field__label">Roles</div>
                  {community.roles.map((r) => (
                    <button
                      key={r.id}
                      className={`role-row__main ${r.id === role ? 'is-active' : ''} ${overwrites.some((o) => o.roleId === r.id) ? 'has-overwrite' : ''}`}
                      onClick={() => setRole(r.id)}
                    >
                      <span
                        className="role-chip__dot"
                        style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
                      />
                      {r.name}
                    </button>
                  ))}
                </div>
                <div className="overwrites__bits">
                  <div className="field__label">{selectedRole.name}</div>
                  {bits.map((bit) => {
                    const info = infoOf(bit);
                    const value = stateOf(role, bit);
                    return (
                      <div key={bit} className="tri-row">
                        <span className="toggle-row__text">
                          <span className="toggle-row__label">{info.label}</span>
                          <span className="toggle-row__help">{info.help}</span>
                        </span>
                        <span className="tri" role="radiogroup" aria-label={info.label}>
                          <button
                            className={`tri__opt tri__opt--deny ${value === 'deny' ? 'is-on' : ''}`}
                            aria-label="Deny"
                            title="Deny"
                            onClick={() => setBit(role, bit, 'deny')}
                          >
                            ✕
                          </button>
                          <button
                            className={`tri__opt ${value === 'inherit' ? 'is-on' : ''}`}
                            aria-label="Inherit"
                            title="Inherit from roles"
                            onClick={() => setBit(role, bit, 'inherit')}
                          >
                            /
                          </button>
                          <button
                            className={`tri__opt tri__opt--allow ${value === 'allow' ? 'is-on' : ''}`}
                            aria-label="Allow"
                            title="Allow"
                            onClick={() => setBit(role, bit, 'allow')}
                          >
                            ✓
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {dirtyPerms && (
                <div className="save-bar">
                  <span>Careful — you have unsaved changes!</span>
                  <button className="btn btn--link" onClick={() => setOverwrites(channel.overwrites)}>
                    Reset
                  </button>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() => void s.run({ a: 'updateChannel', channelId: channel.id, overwrites })}
                  >
                    Save changes
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
