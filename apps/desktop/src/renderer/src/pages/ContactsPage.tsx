import { useEffect, useState, type ReactElement } from 'react';
import type { ConversationView } from '../../../shared/dm.ts';
import { Avatar } from '../community/ui/common.tsx';
import { startDmCall } from '../dm/call.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';

const RIVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Your people: contacts, requests and blocked, with quick actions. */
export function ContactsPage(): ReactElement {
  const dm = useDm();
  const account = useRiver((r) => r.account);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void dm.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  if (account.state !== 'registered') {
    return (
      <div className="page">
        <header className="page__header">
          <div className="eyebrow">Contacts</div>
          <h1 className="page__title">Your people</h1>
          <p className="page__lead">
            Contacts need an account on a River server. Join a community or create one first.
          </p>
        </header>
      </div>
    );
  }

  const direct = dm.conversations.filter(
    (c) => c.kind === 'direct' && c.name.toLowerCase().includes(query.toLowerCase()),
  );
  const groups: Array<[string, ConversationView[]]> = [
    ['Contacts', direct.filter((c) => c.state === 'accepted')],
    ['Requests', direct.filter((c) => c.state === 'request')],
    ['Blocked', direct.filter((c) => c.state === 'blocked')],
  ];

  return (
    <div className="page contacts">
      <header className="page__header">
        <div className="eyebrow">Contacts</div>
        <h1 className="page__title">Your people</h1>
        <p className="page__lead">
          River never uploads an address book. People become contacts when you message each other.
        </p>
      </header>
      <div className="contacts__tools glass">
        <form
          className="contacts__add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!RIVER_ID_RE.test(adding.trim())) return;
            setBusy(true);
            void dm.open(adding.trim().toLowerCase()).finally(() => {
              setBusy(false);
              setAdding('');
            });
          }}
        >
          <label className="textfield">
            <span className="field__label">Add someone by River ID</span>
            <input
              value={adding}
              placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx"
              onChange={(e) => setAdding(e.target.value)}
            />
          </label>
          <button className="btn btn--primary" disabled={busy || !RIVER_ID_RE.test(adding.trim())}>
            {busy ? 'Setting up encryption…' : 'Add and message'}
          </button>
        </form>
        {dm.myId && (
          <button
            className="dms__id"
            onClick={() => void navigator.clipboard.writeText(dm.myId!).then(() => setCopied(true))}
          >
            <span className="muted small">Your River ID</span>
            <code>{dm.myId}</code>
            <span>{copied ? 'Copied ✓' : 'Copy'}</span>
          </button>
        )}
      </div>
      <input
        className="search contacts__search"
        placeholder="Search contacts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title} className="contacts__group">
              <h2 className="contacts__title">
                {title} — {list.length}
              </h2>
              <div className="contacts__grid">
                {list.map((c) => (
                  <ContactCard key={c.riverId} c={c} />
                ))}
              </div>
            </section>
          ),
      )}
      {direct.length === 0 && (
        <p className="muted">No contacts yet — add someone above, or message people from your communities.</p>
      )}
    </div>
  );
}

function ContactCard({ c }: { c: ConversationView }): ReactElement {
  const dm = useDm();
  const navigate = useRiver((r) => r.navigate);
  const open = (): void => {
    navigate('messages');
    dm.select(c.riverId);
  };
  return (
    <div className="contact-card glass">
      <Avatar id={c.riverId} name={c.name} avatar={c.avatar} size={52} />
      <strong className="contact-card__name">
        {c.name}{' '}
        {c.verified && (
          <span className="dm-row__verified" title="Safety number verified">
            ✓
          </span>
        )}
      </strong>
      {c.keyChanged && <span className="chip contact-card__warn">Safety number changed</span>}
      <div className="contact-card__actions">
        {c.state === 'accepted' && (
          <>
            <button className="btn btn--ghost btn--small" onClick={open}>
              Message
            </button>
            <button
              className="btn btn--ghost btn--small"
              aria-label={`Call ${c.name}`}
              onClick={() => {
                open();
                void startDmCall(c.riverId, false);
              }}
            >
              Call
            </button>
          </>
        )}
        {c.state === 'request' && (
          <button className="btn btn--primary btn--small" onClick={open}>
            Review request
          </button>
        )}
        {c.state === 'blocked' && (
          <button
            className="btn btn--ghost btn--small"
            onClick={() => void dm.run({ a: 'unblock', peer: c.riverId })}
          >
            Unblock
          </button>
        )}
      </div>
    </div>
  );
}
