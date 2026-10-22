/** Server data shown in the Hub (day, tasks, meetings, minutes, notifications), refreshed by SSE events. */
import { create } from 'zustand';
import { api, useSession } from '../esiri/session';

export interface DayItem {
  key: string;
  id: number;
  type: 'item' | 'meeting' | 'task';
  kind: 'meeting' | 'task' | 'call' | 'personal' | 'other';
  source: string;
  title: string;
  start_at: string;
  end_at: string | null;
  time: string;
  done: boolean;
  room_id?: string;
  status?: string;
  is_organizer?: boolean;
  notes?: string;
}

export interface Person {
  id: number;
  display_name: string;
}

export interface TaskRow {
  id: number;
  title: string;
  description: string;
  assigned_by: Person | null;
  assigned_to: Person | null;
  start_date: string;
  due_at: string | null;
  due_local: string;
  status: 'assigned' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

export interface MeetingRow {
  id: number;
  room_id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: 'scheduled' | 'live' | 'ended';
  organizer: Person | null;
  is_organizer: boolean;
  invitees: { id: number; display_name: string; email: string; has_account: boolean }[];
}

export interface NotificationRow {
  id: number;
  kind: string;
  title_sw: string;
  title_en: string;
  body_sw: string;
  body_en: string;
  link: string;
  created_at: string;
  read: boolean;
}

export interface MinutesContent {
  title?: string;
  summary?: string;
  topics?: string[];
  themes?: { title: string; points: ({ text: string } | string)[] }[];
  agenda_items?: { number: number; title: string; key_points?: { text: string }[]; resolutions?: { text: string }[] }[];
  decisions?: { text: string }[];
  action_items?: { number: number; task: string; owner: string; due: string; status: string }[];
  attendance?: { present?: { name: string; role?: string }[] };
  date?: string;
}

export interface KatibuJobRow {
  id: number;
  room_id: string;
  title: string;
  scheduled_meeting_id: number | null;
  katibu_meeting_uid: string;
  audio_source: 'live' | 'sample';
  audio_note: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'sent';
  progress: number;
  stage: string;
  stage_sw: string;
  stage_en: string;
  error: { en?: string; sw?: string };
  minutes_sw: MinutesContent;
  minutes_en: MinutesContent;
  documents: { language: string; format: string; fileName: string; size: number; pageCount: number; approved: boolean }[];
  deliveries: { email: string; displayName: string; status: string; sentAt: string | null; error: string }[];
  recipients: string[];
  created_at: string;
  ready_at: string | null;
  sent_at: string | null;
  processing_seconds: number | null;
  default_recipients?: string[];
}

interface HubState {
  day: { date: string; items: DayItem[]; loaded: boolean };
  tasksMine: TaskRow[];
  tasksAssigned: TaskRow[];
  tasksLoaded: boolean;
  meetings: MeetingRow[];
  meetingsLoaded: boolean;
  notifications: NotificationRow[];
  notificationsLoaded: boolean;
  mailUnread: number;
  jobs: KatibuJobRow[];
  jobsLoaded: boolean;

  loadDay: () => Promise<void>;
  loadTasks: () => Promise<void>;
  loadMeetings: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  loadMailCount: () => Promise<void>;
  loadJobs: () => Promise<void>;
  upsertJob: (job: KatibuJobRow) => void;
  loadAll: () => Promise<void>;
  reset: () => void;
}

const empty = {
  day: { date: '', items: [] as DayItem[], loaded: false },
  tasksMine: [] as TaskRow[],
  tasksAssigned: [] as TaskRow[],
  tasksLoaded: false,
  meetings: [] as MeetingRow[],
  meetingsLoaded: false,
  notifications: [] as NotificationRow[],
  notificationsLoaded: false,
  mailUnread: 0,
  jobs: [] as KatibuJobRow[],
  jobsLoaded: false,
};

const signedIn = () => !!useSession.getState().token;

export const useHub = create<HubState>()((set, get) => ({
  ...empty,
  loadDay: async () => {
    if (!signedIn()) return;
    try {
      const d = await api<{ date: string; items: DayItem[] }>('/api/day');
      set({ day: { date: d.date, items: d.items, loaded: true } });
    } catch {
      /* keep what we have */
    }
  },
  loadTasks: async () => {
    if (!signedIn()) return;
    try {
      const [mine, assigned] = await Promise.all([
        api<TaskRow[]>('/api/tasks?scope=mine'),
        api<TaskRow[]>('/api/tasks?scope=assigned_by_me'),
      ]);
      set({ tasksMine: mine, tasksAssigned: assigned, tasksLoaded: true });
    } catch {
      /* ignore */
    }
  },
  loadMeetings: async () => {
    if (!signedIn()) return;
    try {
      set({ meetings: await api<MeetingRow[]>('/api/meetings'), meetingsLoaded: true });
    } catch {
      /* ignore */
    }
  },
  loadNotifications: async () => {
    if (!signedIn()) return;
    try {
      set({ notifications: await api<NotificationRow[]>('/api/notifications'), notificationsLoaded: true });
    } catch {
      /* ignore */
    }
  },
  loadMailCount: async () => {
    if (!signedIn()) return;
    try {
      const r = await api<{ unread: number }>('/api/mail?folder=inbox');
      set({ mailUnread: r.unread });
    } catch {
      /* ignore */
    }
  },
  loadJobs: async () => {
    if (!signedIn()) return;
    try {
      set({ jobs: await api<KatibuJobRow[]>('/api/katibu/jobs'), jobsLoaded: true });
    } catch {
      /* ignore */
    }
  },
  upsertJob: (job) =>
    set((s) => ({ jobs: s.jobs.some((j) => j.id === job.id) ? s.jobs.map((j) => (j.id === job.id ? { ...j, ...job } : j)) : [job, ...s.jobs] })),
  loadAll: async () => {
    const g = get();
    await Promise.all([g.loadDay(), g.loadTasks(), g.loadMeetings(), g.loadNotifications(), g.loadMailCount(), g.loadJobs()]);
  },
  reset: () => set({ ...empty }),
}));
