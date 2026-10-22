import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  faCalendarDay, faCheck, faEnvelope, faFileLines, faListCheck, faMicrophoneLines, faPhone, faPlay, faTrashCan, faUser,
  faVideo, faWandMagicSparkles, faCircleDot,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { api, useSession } from '../esiri/session';
import { activate } from '../esiri/controller';
import { startBriefing } from '../esiri/briefing';
import { startScheduledMeeting } from '../esiri/meetingFlow';
import { Orb } from '../esiri/ui/Orb';
import { useEsiri } from '../esiri/esiriStore';
import { orbStateFor } from '../esiri/ui/orbState';
import { useHub, type DayItem } from './hubStore';
import { HubLayout } from './HubLayout';
import { Card, CountUp, Fa, IconShape, Skeleton, countdown, hm, localHour, longDate, useNow } from './ui';

export const KIND_ICON: Record<DayItem['kind'], IconDefinition> = {
  meeting: faVideo,
  task: faListCheck,
  call: faPhone,
  personal: faUser,
  other: faCircleDot,
};

export function greetingKey(): I18nKey {
  const h = localHour();
  if (h < 12) return 'today.greet.morning';
  if (h < 16) return 'today.greet.afternoon';
  if (h < 19) return 'today.greet.evening';
  return 'today.greet.night';
}

function Timeline({ items, now }: { items: DayItem[]; now: number }) {
  const t = useT();
  const { loadDay, loadTasks } = useHub.getState();
  const nextIdx = items.findIndex((i) => !i.done && new Date(i.start_at).getTime() >= now);
  const nowIdx = items.findIndex((i) => new Date(i.start_at).getTime() > now);
  const insertAt = nowIdx === -1 ? items.length : nowIdx;

  // Rail fill: proportional position of "now" between the surrounding items.
  const fill = useMemo(() => {
    if (!items.length) return 0;
    const n = items.length;
    if (insertAt === 0) return 0;
    if (insertAt >= n) return 100;
    const a = new Date(items[insertAt - 1].start_at).getTime();
    const b = new Date(items[insertAt].start_at).getTime();
    const frac = b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 0;
    return ((insertAt - 1 + frac) / Math.max(1, n - 1)) * 100;
  }, [items, insertAt, now]);

  const markDone = async (it: DayItem) => {
    if (it.type === 'task') await api(`/api/tasks/${it.id}`, { method: 'PATCH', body: { status: 'done' } }).catch(() => undefined);
    else await api(`/api/day/items/${it.id}`, { method: 'PATCH', body: { done: true } }).catch(() => undefined);
    void loadDay();
    void loadTasks();
  };
  const remove = async (it: DayItem) => {
    await api(`/api/day/items/${it.id}`, { method: 'DELETE' }).catch(() => undefined);
    void loadDay();
  };

  const nowRow = (
    <div className="tl-now" data-testid="now-marker" key="now">
      <span className="tl-now-time">{hm(new Date(now).toISOString())}</span>
      <span className="tl-now-dot" />
      <span className="tl-now-line" />
    </div>
  );

  const rows: JSX.Element[] = [];
  items.forEach((it, i) => {
    if (i === insertAt) rows.push(nowRow);
    const past = new Date(it.start_at).getTime() < now;
    const isNext = i === nextIdx;
    rows.push(
      <div
        key={it.key}
        className={`tl-row rise ${past ? 'past' : ''} ${it.done ? 'done' : ''} ${isNext ? 'next' : ''}`}
        style={{ ['--i' as string]: i }}
        data-testid="timeline-item"
        data-key={it.key}
        data-start={it.start_at}
      >
        <span className="tl-time">{hm(it.start_at)}</span>
        <span className="tl-dot">
          <IconShape icon={KIND_ICON[it.kind]} tone={isNext ? 'orange' : it.done ? 'frost' : 'navy'} size={36} />
        </span>
        <div className="tl-body">
          {isNext && <div className="tl-next-label">{t('today.next')}</div>}
          <div className="tl-title">{it.title}</div>
          <div className="tl-meta">
            <span className="chip">{t(`kind.${it.kind}` as I18nKey)}</span>
            {it.source === 'briefing' && <span className="chip new">{t('source.briefing')}</span>}
            {it.type === 'meeting' && it.status === 'live' && <span className="chip green">{t('meeting.status.live')}</span>}
            {it.end_at && <span className="t-small">– {hm(it.end_at)}</span>}
          </div>
        </div>
        <div className="tl-actions">
          {it.type === 'meeting' && !it.done && (
            <button
              className="hbtn sm royal"
              onClick={() => startScheduledMeeting(it.room_id ?? '', it.id)}
              {...ez(`hub.item.${it.key}.start`, t(it.is_organizer ? 'today.startMeeting' : 'today.joinMeeting'), { sensitive: true })}
            >
              <Fa icon={faPlay} /> {t(it.is_organizer ? 'today.start' : 'today.join')}
            </button>
          )}
          {it.type !== 'meeting' && !it.done && (
            <button className="hbtn icon ghost" title={t('today.markDone')} aria-label={t('today.markDone')} onClick={() => void markDone(it)} {...ez(`hub.item.${it.key}.done`, t('today.markDone'))}>
              <Fa icon={faCheck} />
            </button>
          )}
          {it.type === 'item' && (
            <button className="hbtn icon ghost" title={t('today.delete')} aria-label={t('today.delete')} onClick={() => void remove(it)} {...ez(`hub.item.${it.key}.delete`, t('today.delete'))}>
              <Fa icon={faTrashCan} />
            </button>
          )}
        </div>
      </div>,
    );
  });
  if (insertAt >= items.length) rows.push(nowRow);

  return (
    <div className="timeline" data-testid="timeline">
      <div className="tl-rail">
        <div className="tl-fill" style={{ height: `${fill}%` }} />
      </div>
      {rows}
    </div>
  );
}

export default function Today() {
  const t = useT();
  const lang = useLang();
  const user = useSession((s) => s.user);
  const day = useHub((s) => s.day);
  const tasks = useHub((s) => s.tasksMine);
  const mailUnread = useHub((s) => s.mailUnread);
  const jobs = useHub((s) => s.jobs);
  const now = useNow(1000);
  const status = useEsiri((s) => s.status);
  const micOpen = useEsiri((s) => s.micOpen);

  useEffect(() => {
    void useHub.getState().loadAll();
  }, []);

  const items = day.items;
  const nextMeeting = items.find((i) => i.type === 'meeting' && !i.done && new Date(i.end_at ?? i.start_at).getTime() > now);
  const openTasks = tasks.filter((x) => x.status !== 'done');
  const dueToday = items.filter((i) => i.type === 'task' && !i.done).length;
  const minutesReady = jobs.filter((j) => j.status === 'ready' || j.status === 'sent').length;
  const upcoming = items.filter((i) => !i.done && new Date(i.start_at).getTime() >= now).length;
  const name = user?.first_name ?? '';

  return (
    <HubLayout title={t('hub.nav.today')} subtitle={longDate(new Date(now).toISOString(), lang)}>
      <section className="today-hero rise" data-testid="today-hero">
        <img className="hero-bg" src="/brand/circuit-header.png" alt="" aria-hidden="true" />
        <div className="hero-text">
          <h2 className="hero-greet" data-testid="greeting">
            {t(greetingKey(), { name })}
          </h2>
          <div className="hero-date">{longDate(new Date(now).toISOString(), lang)}</div>
          <div className="hero-line">{upcoming ? t('today.heroLine', { n: upcoming }) : t('today.heroLineEmpty')}</div>
          <div className="hero-actions">
            <button className="hbtn light" onClick={() => startBriefing()} data-testid="plan-day" {...ez('hub.today.plan-btn', t('today.plan'))}>
              <Fa icon={faWandMagicSparkles} /> {t('today.plan')}
            </button>
            <button className="hbtn on-dark" onClick={() => activate()} data-testid="hero-talk">
              <Fa icon={faMicrophoneLines} /> {t('hub.talkToNuru')}
            </button>
          </div>
        </div>
        <button className="hero-orb" onClick={() => activate()} aria-label={t('esiri.orbTooltip')} data-testid="hub-orb">
          <Orb size={150} state={orbStateFor(status, micOpen, false)} />
        </button>
      </section>

      <div className="grid-4">
        <Card i={1} className="stat">
          <div className="stat-top">
            <span className="t-label">{t('today.card.nextMeeting')}</span>
            <IconShape icon={faVideo} tone="navy" size={34} />
          </div>
          <div className="stat-value" data-testid="next-countdown">
            {nextMeeting ? (new Date(nextMeeting.start_at).getTime() > now ? countdown(nextMeeting.start_at, now) : t('today.now')) : '—'}
          </div>
          <div className="stat-sub">{nextMeeting ? t('today.startsAt', { time: hm(nextMeeting.start_at), title: nextMeeting.title }) : t('today.noMeeting')}</div>
        </Card>
        <Link to="/hub/tasks" className="hcard rise stat" style={{ ['--i' as string]: 2 }}>
          <div className="stat-top">
            <span className="t-label">{t('today.card.tasks')}</span>
            <IconShape icon={faListCheck} tone="royal" size={34} />
          </div>
          <div className="stat-value"><CountUp value={openTasks.length} /></div>
          <div className="stat-sub">{t('today.card.tasksSub', { n: dueToday })}</div>
        </Link>
        <Link to="/gms/inbox" className="hcard rise stat" style={{ ['--i' as string]: 3 }}>
          <div className="stat-top">
            <span className="t-label">{t('today.card.mail')}</span>
            <IconShape icon={faEnvelope} tone="frost" size={34} />
          </div>
          <div className="stat-value" data-testid="mail-unread"><CountUp value={mailUnread} /></div>
          <div className="stat-sub">{t('today.card.mailSub')}</div>
        </Link>
        <Link to="/hub/minutes" className="hcard rise stat" style={{ ['--i' as string]: 4 }}>
          <div className="stat-top">
            <span className="t-label">{t('today.card.minutes')}</span>
            <IconShape icon={faFileLines} tone="frost" size={34} />
          </div>
          <div className="stat-value"><CountUp value={minutesReady} /></div>
          <div className="stat-sub">{t('today.card.minutesSub')}</div>
        </Link>
      </div>

      <Card i={5}>
        <div className="hcard-head">
          <IconShape icon={faCalendarDay} tone="navy" size={38} shape="tile" />
          <h2 className="t-section">{t('today.timeline')}</h2>
          <span className="chip">{t('today.items', { n: items.length })}</span>
        </div>
        {!day.loaded ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <Skeleton h={44} />
            <Skeleton h={44} />
            <Skeleton h={44} />
          </div>
        ) : items.length === 0 ? (
          <p className="t-small">{t('today.empty')}</p>
        ) : (
          <Timeline items={items} now={now} />
        )}
      </Card>
    </HubLayout>
  );
}
