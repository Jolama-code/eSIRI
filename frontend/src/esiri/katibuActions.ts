/** Katibu actions shared by the Hub buttons and the agent tools. */
import { api, HttpError } from './session';
import { useApp } from '../store/appStore';
import { tr } from '../i18n';
import { useHub, type KatibuJobRow } from '../hub/hubStore';
import { logActivity } from './controller';

const lang = () => useApp.getState().language;

/** Approve and e-mail the minutes. The caller must already have the user's explicit consent. */
export async function sendMinutes(jobId: number, opts: { confirmedSummary: string; recipients?: string[] }): Promise<{ ok: boolean; error?: string; job?: KatibuJobRow }> {
  const started = Date.now();
  try {
    const job = await api<KatibuJobRow & { gms_users: number[] }>(`/api/katibu/jobs/${jobId}/send`, { body: { recipients: opts.recipients ?? null } });
    useHub.getState().upsertJob(job);
    logActivity({
      system: 'katibu',
      request: tr(lang(), 'minutes.auditSend', { title: job.title }),
      outcome: 'Completed',
      finalMessage: tr(lang(), job.recipients.length === 1 ? 'minutes.sentToOne' : 'minutes.sentTo', { n: job.recipients.length }),
      confirmations: [{ summary: opts.confirmedSummary, result: 'approved' }],
      steps: [{ time: new Date().toISOString(), tool: 'katibu_send_minutes', target: job.recipients.join(', '), ok: true }],
      startedAt: started,
    });
    const { announce } = await import('./proactive');
    void announce(tr(lang(), job.recipients.length === 1 ? 'minutes.sentToOne' : 'minutes.sentTo', { n: job.recipients.length }));
    return { ok: true, job };
  } catch (e) {
    const msg = e instanceof HttpError ? (lang() === 'sw' ? e.messageSw : e.message) : String(e);
    logActivity({ system: 'katibu', request: tr(lang(), 'minutes.auditSend', { title: String(jobId) }), outcome: 'Failed', finalMessage: msg, startedAt: started });
    return { ok: false, error: msg };
  }
}
