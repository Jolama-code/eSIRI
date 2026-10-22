import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { faArrowUpRightFromSquare, faFileLines, faVideo } from '@fortawesome/free-solid-svg-icons';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { startScheduledMeeting } from '../esiri/meetingFlow';
import { useHub, type MeetingRow } from './hubStore';
import { HubLayout } from './HubLayout';
import { Card, Empty, Fa, IconShape, Skeleton, dateTime, hm } from './ui';

function MeetingList({ rows, past }: { rows: MeetingRow[]; past: boolean }) {
  const t = useT();
  const lang = useLang();
  const jobs = useHub((s) => s.jobs);
  if (!rows.length) return <Empty icon={faVideo} text={t(past ? 'meetings.emptyPast' : 'meetings.emptyUpcoming')} />;
  return (
    <div className="hlist">
      {rows.map((m, i) => {
        const job = jobs.find((j) => j.scheduled_meeting_id === m.id);
        return (
          <div className="hrow rise" key={m.id} style={{ ['--i' as string]: i }} data-testid="meeting-row">
            <IconShape icon={faVideo} tone={m.status === 'live' ? 'royal' : past ? 'frost' : 'navy'} size={40} shape="tile" />
            <div style={{ minWidth: 0 }}>
              <div className="hrow-title">{m.title}</div>
              <div className="hrow-sub">
                {dateTime(m.start_at, lang)} – {hm(m.end_at)} · {m.is_organizer ? t('meetings.youOrganize') : t('meetings.by', { name: m.organizer?.display_name ?? '' })}
              </div>
              <div className="hrow-sub">{m.invitees.map((p) => p.display_name).join(', ')}</div>
            </div>
            <div className="hrow-side">
              <span className={`chip ${m.status === 'live' ? 'green' : ''}`}>{t(`meeting.status.${m.status}` as I18nKey)}</span>
              {past ? (
                job ? (
                  <Link className="hbtn sm ghost" to={`/hub/minutes/${job.id}`} data-testid="meeting-minutes-link">
                    <Fa icon={faFileLines} /> {t(`minutes.status.${job.status}` as I18nKey)}
                  </Link>
                ) : (
                  <span className="chip">{t('meetings.noMinutes')}</span>
                )
              ) : (
                <button className="hbtn sm royal" onClick={() => startScheduledMeeting(m.room_id, m.id)} {...ez(`hub.meeting.${m.id}.open`, t('meetings.open'), { sensitive: true })}>
                  <Fa icon={faArrowUpRightFromSquare} /> {t('meetings.open')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Meetings() {
  const t = useT();
  const meetings = useHub((s) => s.meetings);
  const loaded = useHub((s) => s.meetingsLoaded);
  useEffect(() => {
    void useHub.getState().loadMeetings();
    void useHub.getState().loadJobs();
  }, []);
  const now = Date.now();
  const upcoming = meetings.filter((m) => m.status !== 'ended' && new Date(m.end_at).getTime() > now);
  const past = meetings.filter((m) => !upcoming.includes(m)).reverse();
  return (
    <HubLayout title={t('hub.nav.meetings')} subtitle={t('meetings.subtitle')}>
      <Card i={1}>
        <div className="hcard-head">
          <h2 className="t-section">{t('meetings.upcoming')}</h2>
        </div>
        {loaded ? <MeetingList rows={upcoming} past={false} /> : <Skeleton h={60} />}
      </Card>
      <Card i={2}>
        <div className="hcard-head">
          <h2 className="t-section">{t('meetings.past')}</h2>
        </div>
        {loaded ? <MeetingList rows={past} past /> : <Skeleton h={60} />}
      </Card>
    </HubLayout>
  );
}
