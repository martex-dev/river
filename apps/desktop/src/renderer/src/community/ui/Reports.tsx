import { useEffect, useState, type ReactElement } from 'react';
import { REPORT_REASONS, type ReportView } from '../../../../shared/community-actions.ts';
import type { ChatMessage, CommunityView } from '../../../../shared/ipc.ts';
import { clockDateTime } from '../../time.ts';
import { useCommunity } from '../store.ts';
import { Modal } from './common.tsx';
import { msg, rich, tr } from '../../i18n.ts';

/** A report's reason ("Spam: details"), its reason in River's language (it is sent in English). */
function reasonText(reason: string): string {
  const known = REPORT_REASONS.find((r) => reason === r || reason.startsWith(`${r}: `));
  return known ? tr(known) + reason.slice(known.length) : reason;
}

/** Right-click a message → Report message (1.0.21): goes to this community's moderators. */
export function ReportDialog({
  community,
  message,
}: {
  community: CommunityView;
  message: ChatMessage;
}): ReactElement {
  const s = useCommunity();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const close = (): void => s.setModal(null);
  const send = async (): Promise<void> => {
    if (!reason) return;
    setBusy(true);
    const text = details.trim() ? `${reason}: ${details.trim()}` : reason;
    const res = await s.run({
      a: 'report',
      communityId: community.id,
      messageId: message.id,
      reason: text.slice(0, 500),
      text:
        message.text.slice(0, 2000) ||
        message.attachments
          .map((a) => a.name)
          .join(', ')
          .slice(0, 2000),
      senderName: message.senderName.slice(0, 64),
    });
    setBusy(false);
    if (res) {
      close();
      s.notify(tr("Thanks — {name}'s moderators will take a look.", { name: community.name }));
    }
  };
  return (
    <Modal title={tr('Report message')} onClose={close}>
      <form
        className="create-channel report-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <blockquote className="report-form__quote">
          <strong>{message.senderName}</strong>
          <span>{message.text.slice(0, 300) || tr('An attachment')}</span>
        </blockquote>
        <fieldset className="report-form__reasons">
          <legend className="field__label">{tr('What is wrong with it?')}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className={`radio-card ${reason === r ? 'is-active' : ''}`}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
              {tr(r)}
            </label>
          ))}
        </fieldset>
        <label className="textfield">
          <span className="field__label">{tr('Anything to add? (optional)')}</span>
          <textarea value={details} maxLength={400} rows={2} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <p className="muted small">
          {tr(
            'Only people who moderate messages in {name} see reports — never River or the server operator. They see who reported and a copy of the message, encrypted like everything else here.',
            { name: community.name },
          )}
        </p>
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={close}>
            {tr('Cancel')}
          </button>
          <button className="btn btn--danger" disabled={!reason || busy}>
            {tr('Report')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_LABEL: Record<ReportView['status'], string> = {
  open: msg('Open'),
  resolved: msg('Resolved'),
  dismissed: msg('Dismissed'),
};

/** Community settings → Reports (1.0.21), for people who may manage messages. */
export function ReportsPanel({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const reports = useCommunity((x) => x.reports[community.id]);
  const [show, setShow] = useState<'open' | 'all'>('open');
  useEffect(() => {
    void s.loadReports(community.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id]);
  const shown = (reports ?? []).filter((r) => show === 'all' || r.status === 'open');
  const channelName = (id: string): string =>
    community.channels.find((c) => c.id === id)?.name ?? tr('channel');
  const setStatus = async (r: ReportView, status: ReportView['status']): Promise<void> => {
    const res = await s.run({ a: 'updateReport', reportId: r.id, status });
    if (res !== null) void s.loadReports(community.id);
  };
  return (
    <div className="settings-page">
      <h2>{tr('Reports')}</h2>
      <p className="muted small">
        {tr(
          'Messages members reported. Each shows the message as the reporter saw it; open the original to check it. Handling a report is recorded in the audit log.',
        )}
      </p>
      <div className="segmented" role="tablist" aria-label={tr('Which reports')}>
        <button
          role="tab"
          aria-selected={show === 'open'}
          className={`segmented__item ${show === 'open' ? 'is-active' : ''}`}
          onClick={() => setShow('open')}
        >
          {tr('Open ({count})', { count: (reports ?? []).filter((r) => r.status === 'open').length })}
        </button>
        <button
          role="tab"
          aria-selected={show === 'all'}
          className={`segmented__item ${show === 'all' ? 'is-active' : ''}`}
          onClick={() => setShow('all')}
        >
          {tr('All')}
        </button>
      </div>
      {reports === undefined && <p className="muted">{tr('Loading…')}</p>}
      {reports && shown.length === 0 && (
        <p className="muted">{show === 'open' ? tr('Nothing to review. 🎉') : tr('No reports yet.')}</p>
      )}
      <ul className="report-list">
        {shown.map((r) => (
          <li key={r.id} className={`report report--${r.status}`}>
            <div className="report__head">
              <span className={`report__status report__status--${r.status}`}>
                {tr(STATUS_LABEL[r.status])}
              </span>
              <span className="muted small">
                {rich(tr('{reporter} reported {name} in #{channel}'), {
                  reporter: r.reporterName,
                  name: <strong>{r.targetName}</strong>,
                  channel: channelName(r.channelId),
                })}{' '}
                · {clockDateTime(r.createdAt)}
              </span>
            </div>
            <div className="report__reason">{reasonText(r.reason)}</div>
            {r.text && <blockquote className="report-form__quote">{r.text}</blockquote>}
            {r.status !== 'open' && r.resolvedByName && (
              <div className="muted small">
                {r.status === 'resolved'
                  ? tr('Resolved by {name}', { name: r.resolvedByName })
                  : tr('Dismissed by {name}', { name: r.resolvedByName })}
                {r.resolvedAt ? ` · ${clockDateTime(r.resolvedAt)}` : ''}
              </div>
            )}
            <div className="report__actions">
              <button
                className="btn btn--ghost btn--small"
                onClick={() => {
                  s.setModal(null);
                  s.openMessage(community.id, r.channelId, r.messageId);
                }}
              >
                {tr('Open message')}
              </button>
              {r.status === 'open' ? (
                <>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() => void setStatus(r, 'resolved')}
                  >
                    {tr('Resolve')}
                  </button>
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => void setStatus(r, 'dismissed')}
                  >
                    {tr('Dismiss')}
                  </button>
                </>
              ) : (
                <button className="btn btn--link btn--small" onClick={() => void setStatus(r, 'open')}>
                  {tr('Reopen')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
