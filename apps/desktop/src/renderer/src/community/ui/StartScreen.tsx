import { useState, type FormEvent, type ReactElement } from 'react';
import { looksLikeInvite } from '../../../../shared/invite-link.ts';
import { COMMUNITY_TEMPLATES, templateById, type TemplateId } from '../../../../shared/templates.ts';
import { useRiver } from '../../store.ts';
import { celebrate } from '../fx.tsx';
import { play } from '../sound.ts';
import { useCommunity } from '../store.ts';
import { tr } from '../../i18n.ts';

/** Joins with an invite link and opens the community, with sound and celebration. */
export async function joinWithLink(link: string): Promise<string | null> {
  const res = await window.river.community.join(link.trim());
  if (!res.ok) {
    play('error');
    return res.message;
  }
  play('communityJoin');
  celebrate(tr('Welcome to {name}', { name: res.value.name }));
  await useCommunity.getState().load();
  useCommunity.getState().select(res.value.id);
  useRiver.getState().navigate('communities');
  return null;
}

/**
 * The first thing you see in Communities: paste an invite to join, or pick a
 * template and a name to start your own. One screen, no detours.
 */
export function StartScreen(props: {
  onDone(): void;
  canCancel: boolean;
  hasAccount: boolean;
}): ReactElement {
  const savedServer = useRiver((r) => r.settings?.server.url ?? '');
  const [template, setTemplate] = useState<TemplateId>('friends');
  const [name, setName] = useState('');
  const [server, setServer] = useState(savedServer);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  // Without an account, the community (and the account) go to River's server unless you name another.
  const [otherServer, setOtherServer] = useState(Boolean(savedServer));
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = templateById(template);

  const join = async (value: string): Promise<void> => {
    setBusy('join');
    setError(null);
    const failed = await joinWithLink(value);
    setBusy(null);
    if (failed) setError(failed);
    else props.onDone();
  };

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy('create');
    setError(null);
    const serverUrl = otherServer ? server.trim() : '';
    setStep(props.hasAccount ? null : tr('Setting up your account and your community…'));
    const res = await window.river.community.create(name.trim(), {
      template,
      ...(!props.hasAccount && serverUrl ? { serverUrl } : {}),
    });
    setBusy(null);
    setStep(null);
    if (!res.ok) {
      play('error');
      return setError(res.message);
    }
    play('communityJoin');
    celebrate(tr('{name} is ready', { name: res.value.name }));
    if (!props.hasAccount) await useRiver.getState().setAccount(await window.river.account.status());
    await useCommunity.getState().load();
    useCommunity.getState().select(res.value.id);
    props.onDone();
  };

  return (
    <div className="page start">
      <header className="page__header">
        <div className="eyebrow">{tr('Communities')}</div>
        <h1 className="page__title">{tr('Bring your people together')}</h1>
        <p className="page__lead">
          {tr('Private spaces with text, voice and video — encrypted with a key only members have.')}
        </p>
      </header>
      {error && (
        <div className="glass card card--error" role="alert">
          {error}
        </div>
      )}

      <form
        className="glass card start__join"
        onSubmit={(e) => {
          e.preventDefault();
          void join(link);
        }}
      >
        <h2 className="card__title">{tr('Got an invite?')}</h2>
        <div className="start__join-row">
          <input
            aria-label={tr('Invite link')}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onPaste={(e) => {
              // Pasting a whole invite link joins straight away.
              const pasted = e.clipboardData.getData('text');
              if (looksLikeInvite(pasted) && busy === null) {
                e.preventDefault();
                setLink(pasted.trim());
                void join(pasted);
              }
            }}
            placeholder={tr('Paste an invite link')}
            spellCheck={false}
          />
          <button className="btn btn--primary" disabled={busy !== null || link.trim() === ''}>
            {busy === 'join' ? tr('Joining…') : tr('Join community')}
          </button>
        </div>
        <p className="muted small">{tr('River sets everything up, including your account.')}</p>
      </form>

      <form className="glass card start__create" onSubmit={(e) => void create(e)}>
        <h2 className="card__title">{tr('Or start your own')}</h2>
        <div className="templates" role="radiogroup" aria-label={tr('Community template')}>
          {COMMUNITY_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={template === t.id}
              className={`template ${template === t.id ? 'is-active' : ''}`}
              onClick={() => setTemplate(t.id)}
            >
              <span className="template__emoji" aria-hidden="true">
                {t.emoji}
              </span>
              <strong>{tr(t.label)}</strong>
              <span className="muted small">{tr(t.description)}</span>
            </button>
          ))}
        </div>
        <div
          className="template-preview"
          aria-label={tr('{template} channels', { template: tr(chosen.label) })}
        >
          {chosen.layout.map((g) => (
            <div key={g.category ?? 'loose'} className="template-preview__group">
              {g.category && <span className="template-preview__category">{g.category}</span>}
              {g.channels.map((ch) => (
                <span key={ch.name} className="template-preview__channel">
                  {ch.kind === 'text' ? '#' : '🔊'} {ch.name}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="start__fields">
          <label className="textfield">
            <span className="field__label">{tr('Community name')}</span>
            <input
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('e.g. The Crew')}
            />
          </label>
          {!props.hasAccount && otherServer && (
            <label className="textfield">
              <span className="field__label">{tr('Server address')}</span>
              <input
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://river.example.org"
                spellCheck={false}
              />
            </label>
          )}
        </div>
        <div className="button-row">
          <button
            className="btn btn--primary"
            disabled={
              busy !== null ||
              name.trim() === '' ||
              (!props.hasAccount && otherServer && server.trim() === '')
            }
          >
            {busy === 'create' ? tr('Creating…') : tr('Create community')}
          </button>
          {!props.hasAccount && (
            <button type="button" className="btn btn--link" onClick={() => setOtherServer((v) => !v)}>
              {otherServer ? tr('Use River’s server') : tr('Use a different server')}
            </button>
          )}
          {props.canCancel && (
            <button type="button" className="btn btn--link" onClick={props.onDone}>
              ← {tr('Back to my communities')}
            </button>
          )}
        </div>
        {step && (
          <p className="muted small" role="status">
            {step}
          </p>
        )}
      </form>
    </div>
  );
}
