import { useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { Modal, Toggle, can, hex } from './common.tsx';
import { parseWords, type FilterMode } from '../../../../shared/word-filter.ts';

/** Permissions a self-assignable role may not have (the server refuses them too). */
const MODERATING =
  Permission.ADMINISTRATOR |
  Permission.MANAGE_COMMUNITY |
  Permission.MANAGE_CHANNELS |
  Permission.MANAGE_ROLES |
  Permission.MANAGE_MESSAGES |
  Permission.KICK_MEMBERS |
  Permission.BAN_MEMBERS |
  Permission.MUTE_MEMBERS |
  Permission.MOVE_MEMBERS |
  Permission.MODERATE_MEMBERS |
  Permission.VIEW_AUDIT_LOG |
  Permission.MENTION_EVERYONE |
  Permission.MANAGE_EVENTS |
  Permission.MANAGE_EXPRESSIONS;

export const offerable = (permissions: number): boolean => (permissions & MODERATING) === 0;

/** Community settings → Rules & roles (1.0.24). */
export function OnboardingSettings({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [welcome, setWelcome] = useState(community.welcomeNote);
  const [rules, setRules] = useState<string[]>(community.rules);
  const [draft, setDraft] = useState('');
  const [screening, setScreening] = useState(community.screening);
  const [selfRoles, setSelfRoles] = useState<string[]>(community.selfRoles);
  const [busy, setBusy] = useState(false);
  const dirty =
    welcome !== community.welcomeNote ||
    JSON.stringify(rules) !== JSON.stringify(community.rules) ||
    screening !== community.screening ||
    JSON.stringify([...selfRoles].sort()) !== JSON.stringify([...community.selfRoles].sort());
  const roles = community.roles.filter((r) => !r.everyone && r.position < community.myRank);
  const addRule = (): void => {
    const r = draft.trim().slice(0, 300);
    if (!r || rules.length >= 20) return;
    setRules([...rules, r]);
    setDraft('');
  };
  const move = (i: number, d: -1 | 1): void => {
    const next = [...rules];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r!);
    setRules(next);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    const res = await s.run({
      a: 'updateOnboarding',
      communityId: community.id,
      rules,
      welcome,
      screening: screening && rules.length > 0,
      selfRoles,
    });
    setBusy(false);
    if (res !== null) s.notify('Saved.');
  };
  return (
    <div className="settings-page onboarding-settings">
      <h2>Rules & roles</h2>
      <p className="muted small">
        What new members see first. Rules and the welcome note are end-to-end encrypted.
      </p>
      <label className="textfield">
        <span className="field__label">Welcome note</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={welcome}
          placeholder="Glad you're here! Start in #general and say hi."
          onChange={(e) => setWelcome(e.target.value)}
        />
      </label>
      <div className="field__label">Rules</div>
      <ol className="rules-list">
        {rules.map((r, i) => (
          <li key={`${i}-${r}`} className="rules-list__item">
            <span className="rules-list__text">{r}</span>
            <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button
              className="icon-btn"
              aria-label="Move down"
              disabled={i === rules.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              className="btn btn--link btn--danger btn--small"
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <form
        className="forum-settings__add"
        onSubmit={(e) => {
          e.preventDefault();
          addRule();
        }}
      >
        <input
          value={draft}
          maxLength={300}
          placeholder="Add a rule (e.g. Be kind)"
          aria-label="New rule"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn btn--small" disabled={!draft.trim() || rules.length >= 20}>
          Add
        </button>
      </form>
      <Toggle
        label="New members must accept the rules"
        help="Until they do, they can read but not post, react or join voice. People already here are not asked."
        checked={screening && rules.length > 0}
        disabled={rules.length === 0}
        onChange={setScreening}
      />
      <div className="field__label">Roles members can pick themselves</div>
      {roles.length === 0 && (
        <p className="muted small">Create a role (for example "Gamer") to offer it here.</p>
      )}
      <div className="self-roles">
        {roles.map((r) => {
          const ok = offerable(r.permissions);
          return (
            <label key={r.id} className={`self-roles__item ${ok ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                disabled={!ok}
                checked={selfRoles.includes(r.id)}
                onChange={(e) =>
                  setSelfRoles(e.target.checked ? [...selfRoles, r.id] : selfRoles.filter((x) => x !== r.id))
                }
              />
              <span style={r.color ? { color: hex(r.color) } : undefined}>
                {r.icon ? `${r.icon} ` : ''}
                {r.name}
              </span>
              {!ok && <span className="muted small"> — can moderate, so it can't be self-assigned</span>}
            </label>
          );
        })}
      </div>
      {dirty && (
        <div className="save-bar">
          <span>Careful — you have unsaved changes!</span>
          <button
            className="btn btn--link"
            onClick={() => {
              setWelcome(community.welcomeNote);
              setRules(community.rules);
              setScreening(community.screening);
              setSelfRoles(community.selfRoles);
            }}
          >
            Reset
          </button>
          <button className="btn btn--primary btn--small" disabled={busy} onClick={() => void save()}>
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

/** Community settings → Rules & roles → Word filter (1.0.28). */
export function WordFilterSettings({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [text, setText] = useState((community.filter?.words ?? []).join('\n'));
  const [mode, setMode] = useState<FilterMode>(community.filter?.mode ?? 'hide');
  const [busy, setBusy] = useState(false);
  const words = parseWords(text);
  const dirty =
    JSON.stringify(words) !== JSON.stringify(community.filter?.words ?? []) ||
    (words.length > 0 && mode !== (community.filter?.mode ?? 'hide'));
  const save = async (): Promise<void> => {
    setBusy(true);
    const res = await s.run({ a: 'updateFilter', communityId: community.id, words, mode });
    setBusy(false);
    if (res !== null) s.notify(words.length ? 'Word filter saved.' : 'Word filter turned off.');
  };
  return (
    <div className="word-filter">
      <h3>Word filter</h3>
      <p className="muted small">
        One word or phrase per line. Matching ignores case, accents and look-alikes like 4 for a. Your server
        cannot read messages, so every River app applies the filter itself — a modified app could ignore it.
        People who manage messages always see everything.
      </p>
      <textarea
        rows={5}
        value={text}
        aria-label="Filtered words"
        placeholder={'spam\nfree money'}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="radio-cards">
        <label className={`radio-card ${mode === 'hide' ? 'is-active' : ''}`}>
          <input type="radio" checked={mode === 'hide'} onChange={() => setMode('hide')} />
          Hide messages with these words (members can still show them)
        </label>
        <label className={`radio-card ${mode === 'block' ? 'is-active' : ''}`}>
          <input type="radio" checked={mode === 'block'} onChange={() => setMode('block')} />
          Also stop people from sending them
        </label>
      </div>
      <button className="btn btn--primary btn--small" disabled={!dirty || busy} onClick={() => void save()}>
        {words.length || !community.filter ? 'Save filter' : 'Turn off filter'}
      </button>
    </div>
  );
}

/** Shown to new members of a screened community until they accept the rules. */
export function RulesGate({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = async (): Promise<void> => {
    setBusy(true);
    const res = await s.run({ a: 'acceptRules', communityId: community.id });
    setBusy(false);
    if (res === null) return;
    s.notify(`Welcome to ${community.name}!`);
    if (community.selfRoles.length) s.setModal({ kind: 'pick-roles', communityId: community.id });
  };
  return (
    <div className="rules-gate" role="region" aria-label={`Rules of ${community.name}`}>
      <h2>Welcome to {community.name}</h2>
      {community.welcomeNote && <p className="rules-gate__welcome">{community.welcomeNote}</p>}
      <p className="muted small">Before you join in, please read the rules:</p>
      <ol className="rules-gate__rules">
        {community.rules.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ol>
      <label className="rules-gate__agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I&apos;ve read and agree to the rules
      </label>
      <button className="btn btn--primary" disabled={!agreed || busy} onClick={() => void accept()}>
        Join the conversation
      </button>
    </div>
  );
}

/** Pick the roles this community offers (1.0.24). */
export function PickRolesDialog({ community, me }: { community: CommunityView; me: string }): ReactElement {
  const s = useCommunity();
  const mine = community.members.find((m) => m.riverId === me)?.roles ?? [];
  const [chosen, setChosen] = useState<string[]>(community.selfRoles.filter((id) => mine.includes(id)));
  const [busy, setBusy] = useState(false);
  const offered = community.roles.filter((r) => community.selfRoles.includes(r.id));
  const save = async (): Promise<void> => {
    setBusy(true);
    const res = await s.run({ a: 'setSelfRoles', communityId: community.id, roles: chosen });
    setBusy(false);
    if (res !== null) s.setModal(null);
  };
  return (
    <Modal title="Pick your roles" onClose={() => s.setModal(null)}>
      <p className="muted small">Choose what fits you. You can change it any time from the community menu.</p>
      <div className="self-roles self-roles--pick">
        {offered.map((r) => (
          <button
            key={r.id}
            className={`chip self-roles__chip ${chosen.includes(r.id) ? 'is-active' : ''}`}
            aria-pressed={chosen.includes(r.id)}
            style={r.color ? { borderColor: hex(r.color) } : undefined}
            onClick={() =>
              setChosen(chosen.includes(r.id) ? chosen.filter((x) => x !== r.id) : [...chosen, r.id])
            }
          >
            {r.icon ? `${r.icon} ` : ''}
            {r.name}
          </button>
        ))}
      </div>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          Skip
        </button>
        <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Modal>
  );
}

export const canManageOnboarding = (c: CommunityView): boolean =>
  can(c.permissions, Permission.MANAGE_COMMUNITY);
