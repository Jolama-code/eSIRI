import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { create } from 'zustand';
import {
  faBell, faBookOpen, faChartPie, faCheck, faCirclePlus, faClipboardList, faDownload, faEye, faFlask,
  faHourglassHalf, faLayerGroup, faMagnifyingGlass, faRocket, faSliders, faUserCheck, faUserGear, faXmark,
  faChartColumn, faCode,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { Modal } from '../components/Common';
import { api, HttpError, loadDirectory, useSession } from '../esiri/session';
import { useApp } from '../store/appStore';
import type { TaskRow } from '../hub/hubStore';
import { CountUp, Fa } from '../hub/ui';
import './weris.css';

// ---------------------------------------------------------------------------
// Data (read by the agent snapshot too)

export interface Project {
  id: number;
  title: string;
  types: string[];
  leaders: string[];
  start_date: string;
  end_date: string;
  status: string;
  maturity: string;
  reported_this_week: boolean;
}
export interface PdpRow {
  id: number;
  tab: 'pdp' | 'projects' | 'activities';
  skill: string;
  category: string;
  start_date: string;
  end_date: string;
  status: string;
}
export interface Report {
  id: number;
  week: string;
  start_date: string;
  end_date: string;
  status: 'DRAFT' | 'SUBMITTED';
  submitted_at: string | null;
  reviewed_by: string;
  content: string;
}
interface Dashboard {
  total: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  not_reported: string[];
  week: string;
}

interface WerisState {
  dashboard: Dashboard | null;
  projects: Project[];
  pdp: PdpRow[];
  reports: { current_week: string; current: Report | null; total_submitted: number; pending_revisions: number; reports: Report[] } | null;
  tasks: TaskRow[];
  tasksLoaded: boolean;
  loadDashboard: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadPdp: () => Promise<void>;
  loadReports: () => Promise<void>;
  loadTasks: () => Promise<void>;
}

export const useWeris = create<WerisState>()((set) => ({
  dashboard: null,
  projects: [],
  pdp: [],
  reports: null,
  tasks: [],
  tasksLoaded: false,
  loadDashboard: async () => set({ dashboard: await api<Dashboard>('/api/weris/dashboard').catch(() => null) }),
  loadProjects: async () => set({ projects: await api<Project[]>('/api/weris/projects').catch(() => []) }),
  loadPdp: async () => set({ pdp: await api<PdpRow[]>('/api/weris/pdp').catch(() => []) }),
  loadReports: async () => set({ reports: await api<WerisState['reports']>('/api/weris/reports').catch(() => null) }),
  loadTasks: async () => set({ tasks: await api<TaskRow[]>('/api/tasks?scope=all').catch(() => []), tasksLoaded: true }),
}));


// ---------------------------------------------------------------------------
// Frame

function WerisFrame({ crumbs, children }: { crumbs: string[]; children: ReactNode }) {
  const t = useT();
  const user = useSession((s) => s.user);
  const nav: { to: string; id: string; icon: IconDefinition; label: I18nKey }[] = [
    { to: '/weris', id: 'dashboard', icon: faChartPie, label: 'weris.dashboard' },
    { to: '/weris/projects', id: 'projects', icon: faLayerGroup, label: 'weris.projects' },
    { to: '/weris/pdp', id: 'pdp', icon: faUserGear, label: 'weris.pdp' },
    { to: '/weris/tasks', id: 'assignment', icon: faUserCheck, label: 'weris.assignment' },
    { to: '/weris/reports', id: 'reports', icon: faClipboardList, label: 'weris.reports' },
  ];
  return (
    <div className="weris" data-testid="weris">
      <header className="w-top">
        <div className="w-logo">
          <span className="w-logo-ico"><Fa icon={faChartColumn} /></span> WERIS
        </div>
        <span style={{ flex: 1 }} />
        <button className="w-bell" aria-label={t('hub.nav.notifications')} onClick={() => useApp.getState().toast(t('stack.notInDemo'))}>
          <Fa icon={faBell} />
        </button>
        <div className="w-user">
          <div className="w-user-name" data-testid="weris-user">{user?.display_name.toUpperCase()}</div>
          <div className="w-user-mail">{user?.email}</div>
        </div>
        <span className="w-avatar">{user?.display_name.replace(/^Dkt\.\s*/, '').slice(0, 1)}</span>
      </header>
      <div className="w-body">
        <nav className="w-side">
          {nav.map((n) => (
            <NavLink key={n.id} to={n.to} end={n.to === '/weris'} className={({ isActive }) => `w-nav ${isActive ? 'on' : ''}`} {...ez(`weris.nav.${n.id}`, t(n.label))}>
              <Fa icon={n.icon} /> {t(n.label)}
            </NavLink>
          ))}
          <button className="w-nav" onClick={() => useApp.getState().toast(t('stack.notInDemo'))}>
            <Fa icon={faBookOpen} /> {t('weris.manual')}
          </button>
        </nav>
        <main className="w-main">
          <div className="w-crumbs">
            {crumbs.map((c, i) => (
              <span key={c} className={i === crumbs.length - 1 ? 'last' : ''}>
                {c}
              </span>
            ))}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function statusClass(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// Dashboard

function CategoryRings({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const colors = ['#23b8ee', '#254e96', '#1e2761', '#4aa8c3', '#3a84b1', '#0b5b8c', '#5b6b8c'];
  return (
    <div className="w-rings">
      <svg viewBox="0 0 220 220" className="w-rings-svg" aria-hidden="true">
        {entries.map(([k, v], i) => {
          const r = 100 - i * 11;
          const c = 2 * Math.PI * r;
          const frac = (v / max) * 0.75;
          return (
            <g key={k} transform="rotate(-90 110 110)">
              <circle cx="110" cy="110" r={r} fill="none" stroke="#eef2f7" strokeWidth="7" />
              <circle cx="110" cy="110" r={r} fill="none" stroke={colors[i % colors.length]} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} className="w-ring-arc" />
            </g>
          );
        })}
      </svg>
      <ul className="w-legend">
        {entries.map(([k, v], i) => (
          <li key={k}>
            <span style={{ background: colors[i % colors.length] }} /> {k}: <b>{v}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBars({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="w-bars">
      {entries.map(([k, v]) => (
        <div className="w-bar" key={k}>
          <div className="w-bar-track">
            <div className="w-bar-fill" style={{ height: `${(v / max) * 100}%` }}>
              <span>{v}</span>
            </div>
          </div>
          <div className="w-bar-label">{k.replace('On ', '')}</div>
        </div>
      ))}
    </div>
  );
}

export function WerisDashboard() {
  const t = useT();
  const d = useWeris((s) => s.dashboard);
  useEffect(() => {
    void useWeris.getState().loadDashboard();
  }, []);
  const counters: [string, number, IconDefinition][] = d
    ? [
        [t('weris.totalProjects'), d.total, faSliders],
        ['On Development', d.by_status['On Development'] ?? 0, faCode],
        ['On Proof Of Concept', d.by_status['On Proof Of Concept'] ?? 0, faFlask],
        ['On Hold', d.by_status['On Hold'] ?? 0, faXmark],
        ['On Pilot', d.by_status['On Pilot'] ?? 0, faRocket],
        ['On Production', d.by_status['On Production'] ?? 0, faCheck],
      ]
    : [];
  return (
    <WerisFrame crumbs={[t('weris.dashboard')]}>
      <div className="w-counters">
        {counters.map(([label, n, icon], i) => (
          <div className="w-card w-counter rise" key={label} style={{ ['--i' as string]: i }} data-testid="weris-counter">
            <div>
              <div className="w-num"><CountUp value={n} /></div>
              <div className="w-counter-label">{label}</div>
            </div>
            <span className="w-counter-ico"><Fa icon={icon} /></span>
          </div>
        ))}
      </div>
      {d && (
        <div className="w-charts">
          <div className="w-card rise" style={{ ['--i' as string]: 6 }}>
            <h3>{t('weris.byCategory')}</h3>
            <CategoryRings data={d.by_category} />
          </div>
          <div className="w-card rise" style={{ ['--i' as string]: 7 }}>
            <h3>{t('weris.byStatus')}</h3>
            <StatusBars data={d.by_status} />
          </div>
          <div className="w-card rise" style={{ ['--i' as string]: 8 }}>
            <h3>{t('weris.notReported')}</h3>
            <ul className="w-notrep" data-testid="weris-not-reported">
              {d.not_reported.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </WerisFrame>
  );
}

// ---------------------------------------------------------------------------
// Projects

const TYPES = ['AI/ML', 'WEB', 'MOBILE', 'SYSTEMS', 'IOT', 'DESKTOP', 'AR/VR'];
const STATUSES = ['On Development', 'On Proof Of Concept', 'On Hold', 'On Pilot', 'On Production'];
const MATURITY = ['Idea', 'Prototype', 'Development', 'Pilot', 'Production'];

function csv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

export function WerisProjects() {
  const t = useT();
  const projects = useWeris((s) => s.projects);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [maturity, setMaturity] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', types: [] as string[], start_date: '', end_date: '', status: 'On Development', maturity: 'Idea' });
  useEffect(() => {
    void useWeris.getState().loadProjects();
  }, []);
  const shown = projects.filter(
    (p) => (!status || p.status === status) && (!type || p.types.includes(type)) && (!maturity || p.maturity === maturity) && (!q || p.title.toLowerCase().includes(q.toLowerCase())),
  );
  const exportCsv = () => {
    const rows = [['S/N', 'Project Title', 'Types', 'Leader', 'Start Date', 'End Date', 'Status', 'Maturity'], ...shown.map((p, i) => [String(i + 1), p.title, p.types.join(', '), p.leaders.join(', '), p.start_date, p.end_date, p.status, p.maturity])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }));
    a.download = 'weris-projects.csv';
    a.click();
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await api('/api/weris/projects', { body: form }).catch(() => undefined);
    setAdding(false);
    setForm({ title: '', types: [], start_date: '', end_date: '', status: 'On Development', maturity: 'Idea' });
    void useWeris.getState().loadProjects();
  };
  return (
    <WerisFrame crumbs={[t('weris.dashboard'), t('weris.projectList')]}>
      <div className="w-card w-panel">
        <div className="w-panel-head">
          <h2>{t('weris.projects')}</h2>
          <div className="w-filters">
            <select value={status} onChange={(e) => setStatus(e.target.value)} {...ez('weris.projects.filter-status', t('weris.allStatus'))}>
              <option value="">{t('weris.allStatus')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} {...ez('weris.projects.filter-type', t('weris.allTypes'))}>
              <option value="">{t('weris.allTypes')}</option>
              {TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={maturity} onChange={(e) => setMaturity(e.target.value)} {...ez('weris.projects.filter-maturity', t('weris.allMaturity'))}>
              <option value="">{t('weris.allMaturity')}</option>
              {MATURITY.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="w-btn" onClick={() => setAdding(true)} {...ez('weris.projects.add', t('weris.addProject'))}>
              <Fa icon={faCirclePlus} /> {t('weris.addProject')}
            </button>
          </div>
        </div>
        <div className="w-tablebar">
          <div className="w-search">
            <input placeholder={t('weris.search')} value={q} onChange={(e) => setQ(e.target.value)} {...ez('weris.projects.search', t('weris.search'))} />
            <Fa icon={faMagnifyingGlass} />
          </div>
          <button className="w-btn" onClick={exportCsv} data-testid="weris-export" {...ez('weris.projects.export', t('weris.export'))}>
            <Fa icon={faDownload} /> {t('weris.export')}
          </button>
        </div>
        <div className="w-tablewrap">
          <table className="w-table" data-testid="weris-projects">
            <thead>
              <tr>
                <th>S/N</th><th>{t('weris.col.title')}</th><th>{t('weris.col.types')}</th><th>{t('weris.col.leader')}</th><th>{t('weris.col.start')}</th><th>{t('weris.col.end')}</th><th>{t('weris.col.status')}</th><th>{t('weris.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td className="strong">{p.title}</td>
                  <td>{p.types.join(', ')}</td>
                  <td>{p.leaders.map((l) => <div key={l} className="w-dotted">{l}</div>)}</td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td><span className={`w-status ${statusClass(p.status)}`}>{p.status.toUpperCase()}</span></td>
                  <td><Fa icon={faEye} className="w-eye" /></td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={8} className="w-nodata">NO DATA AVAILABLE</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {adding && (
        <Modal name="weris-add-project" title={t('weris.addProject')} onClose={() => setAdding(false)} width={520}
          footer={<><button className="w-btn ghost" onClick={() => setAdding(false)} {...ez('weris.project.cancel', t('weris.cancel'))}>{t('weris.cancel')}</button><button className="w-btn" onClick={(e) => void add(e as unknown as FormEvent)} {...ez('weris.project.submit', t('weris.submit'))}>{t('weris.submit')}</button></>}>
          <form className="w-form" onSubmit={add}>
            <label>{t('weris.col.title')}<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} {...ez('weris.project.title', t('weris.col.title'))} /></label>
            <div className="w-checks">{TYPES.slice(0, 4).map((x) => (
              <label key={x}><input type="checkbox" checked={form.types.includes(x)} onChange={(e) => setForm({ ...form, types: e.target.checked ? [...form.types, x] : form.types.filter((y) => y !== x) })} /> {x}</label>
            ))}</div>
            <div className="w-two">
              <label>{t('weris.col.start')}<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
              <label>{t('weris.col.end')}<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            </div>
            <label>{t('weris.col.status')}<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          </form>
        </Modal>
      )}
    </WerisFrame>
  );
}

// ---------------------------------------------------------------------------
// PDP

export function WerisPdp() {
  const t = useT();
  const rows = useWeris((s) => s.pdp);
  const [tab, setTab] = useState<PdpRow['tab']>('pdp');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ skill: '', category: 'Technical', start_date: '', end_date: '', status: 'Not Started' });
  useEffect(() => {
    void useWeris.getState().loadPdp();
  }, []);
  const shown = rows.filter((r) => r.tab === tab && (!q || r.skill.toLowerCase().includes(q.toLowerCase())));
  const add = async () => {
    if (!form.skill.trim()) return;
    await api('/api/weris/pdp', { body: { ...form, tab } }).catch(() => undefined);
    setAdding(false);
    setForm({ skill: '', category: 'Technical', start_date: '', end_date: '', status: 'Not Started' });
    void useWeris.getState().loadPdp();
  };
  const tabs: [PdpRow['tab'], I18nKey][] = [['pdp', 'weris.pdpTab'], ['projects', 'weris.projectsTab'], ['activities', 'weris.activitiesTab']];
  return (
    <WerisFrame crumbs={[t('weris.pdpUsers'), t('weris.pdpCrumb')]}>
      <div className="w-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} {...ez(`weris.pdp.tab.${id}`, t(label), { state: tab === id ? 'selected' : 'unselected' })}>
            {t(label)}
          </button>
        ))}
      </div>
      <div className="w-card w-panel">
        <div className="w-panel-head">
          <h2>{t('weris.personalDevelopment')}</h2>
          <div className="w-filters">
            <div className="w-search small"><input placeholder={t('weris.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <button className="w-btn" onClick={() => setAdding(true)} {...ez('weris.pdp.new', t('weris.newPdp'))}>
              <Fa icon={faCirclePlus} /> {t('weris.newPdp')}
            </button>
          </div>
        </div>
        <div className="w-tablewrap">
          <table className="w-table" data-testid="weris-pdp">
            <thead><tr><th>S/N</th><th>{t('weris.col.skill')}</th><th>{t('weris.col.category')}</th><th>{t('weris.col.start')}</th><th>{t('weris.col.end')}</th><th>{t('weris.col.status')}</th><th>{t('weris.col.actions')}</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id}><td>{i + 1}</td><td className="strong">{r.skill}</td><td>{r.category}</td><td>{r.start_date}</td><td>{r.end_date}</td><td><span className={`w-status ${statusClass(r.status)}`}>{r.status.toUpperCase()}</span></td><td><Fa icon={faEye} className="w-eye" /></td></tr>
              ))}
              {!shown.length && <tr><td colSpan={7} className="w-nodata">NO DATA AVAILABLE</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {adding && (
        <Modal name="weris-new-pdp" title={t('weris.newPdp')} onClose={() => setAdding(false)} width={480}
          footer={<><button className="w-btn ghost" onClick={() => setAdding(false)}>{t('weris.cancel')}</button><button className="w-btn" onClick={() => void add()} {...ez('weris.pdp.submit', t('weris.submit'))}>{t('weris.submit')}</button></>}>
          <div className="w-form">
            <label>{t('weris.col.skill')}<input value={form.skill} onChange={(e) => setForm({ ...form, skill: e.target.value })} {...ez('weris.pdp.skill', t('weris.col.skill'))} /></label>
            <label>{t('weris.col.category')}<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
            <div className="w-two">
              <label>{t('weris.col.start')}<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
              <label>{t('weris.col.end')}<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            </div>
          </div>
        </Modal>
      )}
    </WerisFrame>
  );
}

// ---------------------------------------------------------------------------
// Assignment → Special Tasks

export interface TaskForm {
  assignee: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  due_time: string;
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());
}

export const useTaskForm = create<{ open: boolean; form: TaskForm; error: string; setOpen: (v: boolean) => void; set: (p: Partial<TaskForm>) => void; setError: (e: string) => void }>()((set) => ({
  open: false,
  form: { assignee: '', title: '', description: '', start_date: '', end_date: '', due_time: '' },
  error: '',
  setOpen: (open) => set({ open, error: '', ...(open ? { form: { assignee: '', title: '', description: '', start_date: todayIso(), end_date: '', due_time: '' } } : {}) }),
  set: (p) => set((s) => ({ form: { ...s.form, ...p } })),
  setError: (error) => set({ error }),
}));

function taskStatusLabel(t: (k: I18nKey) => string, s: TaskRow['status']): string {
  return t(`weris.task.${s}` as I18nKey);
}

export function WerisTasks() {
  const t = useT();
  const lang = useLang();
  const user = useSession((s) => s.user);
  const directory = useSession((s) => s.directory);
  const tasks = useWeris((s) => s.tasks);
  const loaded = useWeris((s) => s.tasksLoaded);
  const { open, form, error, setOpen, set, setError } = useTaskForm();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void useWeris.getState().loadTasks();
    if (!useSession.getState().directory.length) void loadDirectory().catch(() => undefined);
    const onTasks = () => void useWeris.getState().loadTasks();
    window.addEventListener('nuru:tasks', onTasks);
    return () => window.removeEventListener('nuru:tasks', onTasks);
  }, []);

  const people = useMemo(() => directory.filter((p) => p.email.endsWith('@mfano.go.tz') && !['tehama', 'helpdesk', 'mafunzo'].includes(p.username ?? '') && p.id <= 6), [directory]);
  const shown = tasks.filter((x) => !q || x.title.toLowerCase().includes(q.toLowerCase()));
  const assigningOther = !!form.assignee && form.assignee !== String(user?.id ?? '');

  const submit = async () => {
    setError('');
    if (!form.assignee) return setError(t('weris.err.assignee'));
    if (!form.title.trim()) return setError(t('weris.err.title'));
    setBusy(true);
    try {
      const due = form.end_date ? `${form.end_date}T${form.due_time || '17:00'}` : null;
      await api('/api/tasks', {
        body: { title: form.title.trim(), description: form.description.trim(), assigned_to_id: Number(form.assignee), start_date: form.start_date || todayIso(), due_at: due },
      });
      setOpen(false);
      useApp.getState().toast(t('weris.taskAdded'));
      void useWeris.getState().loadTasks();
    } catch (e) {
      setError(e instanceof HttpError ? (lang === 'sw' ? e.messageSw : e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (task: TaskRow, status: string) => {
    await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status } }).catch(() => undefined);
    void useWeris.getState().loadTasks();
  };

  return (
    <WerisFrame crumbs={[t('weris.assignments'), t('weris.specialTasks')]}>
      <div className="w-card w-panel">
        <div className="w-panel-head">
          <h2>{t('weris.specialTasks')}</h2>
          <button className="w-btn big" onClick={() => setOpen(true)} data-testid="weris-add-task" {...ez('weris.tasks.add', t('weris.addTask'))}>
            <Fa icon={faCirclePlus} /> {t('weris.addTask')}
          </button>
        </div>
        <div className="w-tablebar">
          <div className="w-search">
            <input placeholder={t('weris.search')} value={q} onChange={(e) => setQ(e.target.value)} {...ez('weris.tasks.search', t('weris.search'))} />
            <Fa icon={faMagnifyingGlass} />
          </div>
        </div>
        <div className="w-tablewrap">
          <table className="w-table" data-testid="weris-tasks">
            <thead>
              <tr>
                <th>S/N</th><th>{t('weris.col.taskTitle')}</th><th>{t('weris.col.assignedBy')}</th><th>{t('weris.col.assignedTo')}</th><th>{t('weris.col.start')}</th><th>{t('weris.col.end')}</th><th>{t('weris.col.status')}</th><th>{t('weris.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((task, i) => {
                const mine = task.assigned_to?.id === user?.id;
                return (
                  <tr key={task.id} data-testid="weris-task-row" data-task-id={task.id}>
                    <td>{i + 1}</td>
                    <td className="strong">{task.title}</td>
                    <td>{task.assigned_by?.display_name}</td>
                    <td>{task.assigned_to?.display_name}</td>
                    <td>{task.start_date}</td>
                    <td>{task.due_local}</td>
                    <td><span className={`w-status task-${task.status}`} data-testid="weris-task-status">{taskStatusLabel(t, task.status).toUpperCase()}</span></td>
                    <td>
                      {mine ? (
                        <select
                          className="w-mini-select"
                          value={task.status}
                          onChange={(e) => void changeStatus(task, e.target.value)}
                          aria-label={t('tasks.changeStatus')}
                          {...ez(`weris.task.${task.id}.status`, `${t('tasks.changeStatus')}: ${task.title}`, { state: task.status })}
                        >
                          <option value="assigned">{t('weris.task.assigned')}</option>
                          <option value="in_progress">{t('weris.task.in_progress')}</option>
                          <option value="done">{t('weris.task.done')}</option>
                        </select>
                      ) : (
                        <Fa icon={faEye} className="w-eye" />
                      )}
                    </td>
                  </tr>
                );
              })}
              {loaded && !shown.length && <tr><td colSpan={8} className="w-nodata">NO DATA AVAILABLE</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="w-pager"><select defaultValue="10"><option>10</option><option>25</option></select></div>
      </div>
      {open && (
        <Modal
          name="weris-add-task"
          title={t('weris.addTask')}
          onClose={() => setOpen(false)}
          width={560}
          footer={
            <>
              <button className="w-btn ghost" onClick={() => setOpen(false)} {...ez('weris.task.cancel', t('weris.cancel'))}>{t('weris.cancel')}</button>
              <button className="w-btn" disabled={busy} onClick={() => void submit()} data-testid="weris-task-submit" {...ez('weris.task.submit', t('weris.assignTask'), { sensitive: assigningOther })}>
                <Fa icon={faCheck} /> {t('weris.assignTask')}
              </button>
            </>
          }
        >
          <div className="w-form">
            <label>
              {t('weris.assignee')}
              <select value={form.assignee} onChange={(e) => set({ assignee: e.target.value })} data-testid="weris-task-assignee" {...ez('weris.task.assignee', t('weris.assignee'))}>
                <option value="">{t('weris.chooseAssignee')}</option>
                {people.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.display_name}{p.id === user?.id ? ` (${t('weris.me')})` : ''}</option>
                ))}
              </select>
            </label>
            <label>
              {t('weris.col.taskTitle')}
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} data-testid="weris-task-title" {...ez('weris.task.title', t('weris.col.taskTitle'))} />
            </label>
            <label>
              {t('weris.description')}
              <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} {...ez('weris.task.description', t('weris.description'))} />
            </label>
            <div className="w-three">
              <label>{t('weris.col.start')}<input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} {...ez('weris.task.start-date', t('weris.col.start'))} /></label>
              <label>{t('weris.col.end')}<input type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} data-testid="weris-task-end" {...ez('weris.task.end-date', t('weris.col.end'))} /></label>
              <label>{t('weris.dueTime')}<input type="time" value={form.due_time} onChange={(e) => set({ due_time: e.target.value })} data-testid="weris-task-time" {...ez('weris.task.due-time', t('weris.dueTime'))} /></label>
            </div>
            {assigningOther && <div className="w-note"><Fa icon={faHourglassHalf} /> {t('weris.notifyNote')}</div>}
            {error && <div className="w-error" role="alert" data-testid="weris-task-error">{error}</div>}
          </div>
        </Modal>
      )}
    </WerisFrame>
  );
}

// ---------------------------------------------------------------------------
// Weekly reports

export function WerisReports() {
  const t = useT();
  const r = useWeris((s) => s.reports);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => {
    void useWeris.getState().loadReports();
  }, []);
  const save = async (submit: boolean) => {
    await api('/api/weris/reports', { body: { content: text, submit } }).catch(() => undefined);
    setEditing(false);
    void useWeris.getState().loadReports();
  };
  const cur = r?.current;
  const rows = (r?.reports ?? []).filter((x) => !filter || x.status === filter);
  return (
    <WerisFrame crumbs={[t('weris.reports')]}>
      <div className="w-rep-head">
        <h2>{t('weris.weeklyReports')}</h2>
        {cur?.status === 'DRAFT' && (
          <button className="w-btn" onClick={() => { setText(cur.content); setEditing(true); }} {...ez('weris.reports.continue', t('weris.continueEditing'))}>
            {t('weris.continueEditing')}
          </button>
        )}
      </div>
      <div className="w-rep-cards">
        <div className="w-card"><div className="w-small">{t('weris.currentWeek')}</div><div className="w-big">{cur ? `${cur.week} (${cur.start_date} → ${cur.end_date})` : r?.current_week}</div></div>
        <div className="w-card"><div className="w-small">{t('weris.currentStatus')}</div><span className={`w-chip ${cur?.status === 'SUBMITTED' ? 'sub' : 'draft'}`}>{cur?.status ?? 'DRAFT'}</span></div>
        <div className="w-card"><div className="w-small">{t('weris.totalSubmitted')}</div><div className="w-big"><CountUp value={r?.total_submitted ?? 0} /></div></div>
        <div className="w-card"><div className="w-small">{t('weris.pendingRevisions')}</div><div className="w-big">{r?.pending_revisions ?? 0}</div></div>
      </div>
      <div className="w-card w-panel" style={{ padding: 0 }}>
        <div className="w-panel-head" style={{ padding: '14px 16px' }}>
          <span className="w-hist">{t('weris.history')}</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-mini-select">
            <option value="">{t('weris.allStatuses')}</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SUBMITTED">SUBMITTED</option>
          </select>
        </div>
        <div className="w-tablewrap">
          <table className="w-table" data-testid="weris-reports">
            <thead><tr><th>{t('weris.week')}</th><th>{t('weris.dateRange')}</th><th>{t('weris.col.status')}</th><th>{t('weris.submitted')}</th><th>{t('weris.reviewedBy')}</th><th style={{ textAlign: 'right' }}>{t('weris.col.actions')}</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.week}</td>
                  <td>{x.start_date} → {x.end_date}</td>
                  <td><span className={`w-chip ${x.status === 'SUBMITTED' ? 'sub' : 'draft'}`}>{x.status}</span></td>
                  <td>{x.submitted_at ? new Date(x.submitted_at).toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam' }) : '—'}</td>
                  <td>{x.reviewed_by || '—'}</td>
                  <td style={{ textAlign: 'right' }}><span className="w-link">{t('weris.view')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <Modal name="weris-report" title={`${t('weris.weeklyReports')} · ${cur?.week ?? ''}`} onClose={() => setEditing(false)} width={620}
          footer={<><button className="w-btn ghost" onClick={() => void save(false)} {...ez('weris.report.save', t('weris.saveDraft'))}>{t('weris.saveDraft')}</button><button className="w-btn" onClick={() => void save(true)} {...ez('weris.report.submit', t('weris.submitReport'))}>{t('weris.submitReport')}</button></>}>
          <div className="w-form">
            <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} {...ez('weris.report.content', t('weris.reportContent'))} />
          </div>
        </Modal>
      )}
    </WerisFrame>
  );
}
