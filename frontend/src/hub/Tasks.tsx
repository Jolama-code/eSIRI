import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { faArrowUpRightFromSquare, faListCheck, faUserCheck } from '@fortawesome/free-solid-svg-icons';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { api, useSession } from '../esiri/session';
import { useHub, type TaskRow } from './hubStore';
import { HubLayout } from './HubLayout';
import { Card, Empty, Fa, IconShape, Skeleton, dateTime } from './ui';

export function statusChip(status: TaskRow['status']): string {
  return status === 'done' ? 'green' : status === 'in_progress' ? 'amber' : '';
}

function TaskList({ rows, mine }: { rows: TaskRow[]; mine: boolean }) {
  const t = useT();
  const lang = useLang();
  const setStatus = async (task: TaskRow, status: TaskRow['status']) => {
    await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status } }).catch(() => undefined);
    void useHub.getState().loadTasks();
  };
  if (!rows.length) return <Empty icon={faListCheck} text={t(mine ? 'tasks.emptyMine' : 'tasks.emptyAssigned')} />;
  return (
    <div className="hlist">
      {rows.map((task, i) => (
        <div className="hrow rise" key={task.id} style={{ ['--i' as string]: i }} data-testid={mine ? 'task-mine' : 'task-assigned'} data-task-id={task.id}>
          <IconShape icon={mine ? faListCheck : faUserCheck} tone={task.status === 'done' ? 'green' : 'navy'} size={40} shape="tile" />
          <div style={{ minWidth: 0 }}>
            <div className="hrow-title">{task.title}</div>
            <div className="hrow-sub">
              {mine ? t('tasks.from', { name: task.assigned_by?.display_name ?? '' }) : t('tasks.to', { name: task.assigned_to?.display_name ?? '' })}
              {task.due_at && ` · ${t('tasks.due')} ${dateTime(task.due_at, lang)}`}
            </div>
          </div>
          <div className="hrow-side">
            <span className={`chip ${statusChip(task.status)}`} data-testid="task-status">{t(`task.status.${task.status}` as I18nKey)}</span>
            {mine && (
              <select
                className="hselect"
                value={task.status}
                onChange={(e) => void setStatus(task, e.target.value as TaskRow['status'])}
                aria-label={t('tasks.changeStatus')}
                {...ez(`hub.task.${task.id}.status`, t('tasks.changeStatus'), { state: task.status })}
              >
                <option value="assigned">{t('task.status.assigned')}</option>
                <option value="in_progress">{t('task.status.in_progress')}</option>
                <option value="done">{t('task.status.done')}</option>
              </select>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Tasks() {
  const t = useT();
  const role = useSession((s) => s.user?.role);
  const mine = useHub((s) => s.tasksMine);
  const assigned = useHub((s) => s.tasksAssigned);
  const loaded = useHub((s) => s.tasksLoaded);
  const [tab, setTab] = useState<'mine' | 'assigned'>('mine');

  useEffect(() => {
    void useHub.getState().loadTasks();
  }, []);

  const showAssigned = role === 'supervisor' || assigned.length > 0;
  return (
    <HubLayout
      title={t('hub.nav.tasks')}
      subtitle={t('tasks.subtitle')}
      actions={
        <Link to="/weris/tasks" className="hbtn light">
          <Fa icon={faArrowUpRightFromSquare} /> {t('tasks.openWeris')}
        </Link>
      }
    >
      {showAssigned && (
        <div className="tabs" role="tablist">
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')} role="tab" {...ez('hub.tasks.tab.mine', t('tasks.mine'), { state: tab === 'mine' ? 'selected' : 'unselected' })}>
            {t('tasks.mine')} ({mine.length})
          </button>
          <button className={tab === 'assigned' ? 'on' : ''} onClick={() => setTab('assigned')} role="tab" {...ez('hub.tasks.tab.assigned', t('tasks.assigned'), { state: tab === 'assigned' ? 'selected' : 'unselected' })}>
            {t('tasks.assigned')} ({assigned.length})
          </button>
        </div>
      )}
      <Card i={1}>
        {!loaded ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <Skeleton h={50} />
            <Skeleton h={50} />
          </div>
        ) : tab === 'mine' || !showAssigned ? (
          <TaskList rows={mine} mine />
        ) : (
          <TaskList rows={assigned} mine={false} />
        )}
      </Card>
    </HubLayout>
  );
}
