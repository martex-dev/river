import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { FileView } from '../../../shared/dm.ts';
import { AttachmentList, formatBytes, saveAttachment } from '../community/ui/Attachments.tsx';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';
import { tr } from '../i18n.ts';

type Filter = 'all' | 'images' | 'videos' | 'documents';

const FILTER_LABELS: Record<Filter, () => string> = {
  all: () => tr('All'),
  images: () => tr('Images'),
  videos: () => tr('Videos'),
  documents: () => tr('Documents'),
};

const kindOf = (mime: string): Filter =>
  mime.startsWith('image/') ? 'images' : mime.startsWith('video/') ? 'videos' : 'documents';

/** Every file you sent or received in conversations and posts, decrypted only when opened. */
export function FilesPage(): ReactElement {
  const account = useRiver((r) => r.account);
  const navigate = useRiver((r) => r.navigate);
  const [files, setFiles] = useState<FileView[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (account.state !== 'registered') return;
    void window.river.dm.action({ a: 'files' }).then((r) => setFiles(r.ok ? r.value : []));
  }, [account.state]);

  const shown = useMemo(
    () =>
      (files ?? []).filter(
        (f) =>
          (filter === 'all' || kindOf(f.pointer.mime) === filter) &&
          (f.pointer.name.toLowerCase().includes(query.toLowerCase()) ||
            f.fromName.toLowerCase().includes(query.toLowerCase())),
      ),
    [files, filter, query],
  );

  return (
    <div className="page files">
      <header className="page__header">
        <div className="eyebrow">{tr('Files')}</div>
        <h1 className="page__title">{tr('Your files')}</h1>
        <p className="page__lead">
          {tr(
            'Everything shared with you in messages and posts. Each file is encrypted with its own key and only decrypted on this computer when you open or save it.',
          )}
        </p>
      </header>
      {account.state !== 'registered' ? (
        <p className="muted">{tr('Files appear here once you have an account and share something.')}</p>
      ) : (
        <>
          <div className="files__tools">
            <div className="segmented" role="tablist" aria-label={tr('File type')}>
              {(['all', 'images', 'videos', 'documents'] as const).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  className={`segmented__item ${filter === f ? 'is-active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABELS[f]()}
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder={tr('Search by name or person')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {files === null && <p className="muted">{tr('Loading…')}</p>}
          {files !== null && shown.length === 0 && <p className="muted">{tr('No files yet.')}</p>}
          <div className={filter === 'images' ? 'files__gallery' : 'files__list'}>
            {shown.map((f) =>
              filter === 'images' ? (
                <div key={f.pointer.id} className="files__tile">
                  <AttachmentList attachments={[f.pointer]} />
                </div>
              ) : (
                <div key={f.pointer.id} className="files__row glass">
                  <span className="files__icon" aria-hidden="true">
                    {kindOf(f.pointer.mime) === 'images'
                      ? '🖼️'
                      : kindOf(f.pointer.mime) === 'videos'
                        ? '🎬'
                        : '📄'}
                  </span>
                  <span className="files__text">
                    <strong title={f.pointer.name}>{f.pointer.name}</strong>
                    <span className="muted small">
                      {formatBytes(f.pointer.size)} · {f.mine ? tr('You') : f.fromName} · {f.whereName} ·{' '}
                      {new Date(f.sentAt).toLocaleDateString()}
                    </span>
                  </span>
                  {f.where !== 'post' && (
                    <button
                      className="btn btn--link"
                      onClick={() => {
                        navigate('messages');
                        useDm.getState().select(f.where);
                      }}
                    >
                      {tr('Show in chat')}
                    </button>
                  )}
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => void saveAttachment(f.pointer)}
                  >
                    {tr('Save')}
                  </button>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
