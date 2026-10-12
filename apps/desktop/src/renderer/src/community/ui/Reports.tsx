import { useEffect, useState, type ReactElement } from 'react';
import { REPORT_REASONS, type ReportView } from '../../../../shared/community-actions.ts';
import type { ChatMessage, CommunityView } from '../../../../shared/ipc.ts';
import { clockDateTime } from '../../time.ts';
import { useCommunity } from '../store.ts';
import { Modal } from './common.tsx';

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
      s.notify(`Thanks — ${community.name}'s moderators will take a look.`);
    }
  };
  return (
    <Modal title="Report message" onClose={close}>
      <form
        className="create-channel report-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <blockquote className="report-form__quote">
          <strong>{message.senderName}</strong>
          <span>{message.text.slice(0, 300) || 'An attachment'}</span>
        </blockquote>
        <fieldset className="report-form__reasons">
          <legend className="field__label">What is wrong with it?</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className={`radio-card ${reason === r ? 'is-active' : ''}`}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
        </fieldset>
        <label className="textfield">
          <span className="field__label">Anything to add? (optional)</span>
          <textarea value={details} maxLength={400} rows={2} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <p className="muted small">
          Only people who moderate messages in {community.name} see reports — never River or the server
          operator. They see who reported and a copy of the message, encrypted like everything else here.
        </p>
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={close}>
            Cancel
          </button>
          <button className="btn btn--danger" disabled={!reason || busy}>
            Report
          </button>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_LABEL: Record<ReportView['status'], string> = {
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
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
  const channelName = (id: string): string => community.channels.find((c) => c.id === id)?.name ?? 'channel';
  const setStatus = async (r: ReportView, status: ReportView['status']): Promise<void> => {
    const res = await s.run({ a: 'updateReport', reportId: r.id, status });
    if (res !== null) void s.loadReports(community.id);
  };
  return (
    <div className="settings-page">
      <h2>Reports</h2>
      <p className="muted small">
        Messages members reported. Each shows the message as the reporter saw it; open the original to check
        it. Handling a report is recorded in the audit log.
      </p>
      <div className="segmented" role="tablist" aria-label="Which reports">
        <button
          role="tab"
          aria-selected={show === 'open'}
          className={`segmented__item ${show === 'open' ? 'is-active' : ''}`}
          onClick={() => setShow('open')}
        >
          Open ({(reports ?? []).filter((r) => r.status === 'open').length})
        </button>
        <button
          role="tab"
          aria-selected={show === 'all'}
          className={`segmented__item ${show === 'all' ? 'is-active' : ''}`}
          onClick={() => setShow('all')}
        >
          All
        </button>
      </div>
      {reports === undefined && <p className="muted">Loading…</p>}
      {reports && shown.length === 0 && (
        <p className="muted">{show === 'open' ? 'Nothing to review. 🎉' : 'No reports yet.'}</p>
      )}
      <ul className="report-list">
        {shown.map((r) => (
          <li key={r.id} className={`report report--${r.status}`}>
            <div className="report__head">
              <span className={`report__status report__status--${r.status}`}>{STATUS_LABEL[r.status]}</span>
              <span className="muted small">
                {r.reporterName} reported <strong>{r.targetName}</strong> in #{channelName(r.channelId)} ·{' '}
                {clockDateTime(r.createdAt)}
              </span>
            </div>
            <div className="report__reason">{r.reason}</div>
            {r.text && <blockquote className="report-form__quote">{r.text}</blockquote>}
            {r.status !== 'open' && r.resolvedByName && (
              <div className="muted small">
                {STATUS_LABEL[r.status]} by {r.resolvedByName}
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
                Open message
              </button>
              {r.status === 'open' ? (
                <>
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() => void setStatus(r, 'resolved')}
                  >
                    Resolve
                  </button>
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => void setStatus(r, 'dismissed')}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <button className="btn btn--link btn--small" onClick={() => void setStatus(r, 'open')}>
                  Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
