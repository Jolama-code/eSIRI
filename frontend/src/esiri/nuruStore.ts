/** UI state of proactive NURU: reminder cards, event toasts, the briefing flow, the unlock overlay, demo controls. */
import { create } from 'zustand';

export interface ReminderCard {
  id: number;
  kind: 'meeting' | 'task' | 'item';
  message_sw: string;
  message_en: string;
  data: {
    title?: string;
    room_id?: string;
    meeting_id?: number;
    organizer?: boolean;
    task_id?: number;
    item_id?: number;
    minutes?: number;
    live?: boolean;
  };
  /** 'waiting' = listening/awaiting a tap; 'handling' = this device is acting on it */
  state: 'waiting' | 'handling';
}

export interface EventToast {
  id: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
}

export type BriefingStage = 'closed' | 'greeting' | 'listening' | 'parsing' | 'review' | 'confirm' | 'saving' | 'done' | 'error';

export interface BriefingItem {
  title: string;
  start: string;
  end: string | null;
  duration_min: number | null;
  kind: 'meeting' | 'task' | 'call' | 'personal' | 'other';
  notes: string;
}

interface NuruState {
  reminders: ReminderCard[];
  toasts: EventToast[];
  briefing: {
    stage: BriefingStage;
    transcript: string;
    interim: string;
    items: BriefingItem[];
    questions: string[];
    existing: { key: string; time: string; title: string; kind: string; start_at: string }[];
    error: string;
  };
  unlockNeeded: boolean;
  demoOpen: boolean;
  /** Pending "Shall I ask Katibu to prepare the minutes?" after a meeting ended. */
  minutesOffer: { roomId: string; title: string; meetingId: number | null } | null;

  addReminder: (r: ReminderCard) => void;
  patchReminder: (id: number, patch: Partial<ReminderCard>) => void;
  removeReminder: (id: number) => void;
  pushToast: (t: Omit<EventToast, 'id'>) => void;
  dismissToast: (id: string) => void;
  setBriefing: (patch: Partial<NuruState['briefing']>) => void;
  setUnlockNeeded: (v: boolean) => void;
  setDemoOpen: (v: boolean) => void;
  setMinutesOffer: (v: NuruState['minutesOffer']) => void;
}

let n = 0;

export const emptyBriefing: NuruState['briefing'] = {
  stage: 'closed',
  transcript: '',
  interim: '',
  items: [],
  questions: [],
  existing: [],
  error: '',
};

export const useNuru = create<NuruState>()((set, get) => ({
  reminders: [],
  toasts: [],
  briefing: emptyBriefing,
  unlockNeeded: false,
  demoOpen: false,
  minutesOffer: null,

  addReminder: (r) => set((s) => ({ reminders: [...s.reminders.filter((x) => x.id !== r.id), r] })),
  patchReminder: (id, patch) => set((s) => ({ reminders: s.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),
  pushToast: (t) => {
    const id = `t${++n}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    window.setTimeout(() => get().dismissToast(id), 9000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setBriefing: (patch) => set((s) => ({ briefing: { ...s.briefing, ...patch } })),
  setUnlockNeeded: (unlockNeeded) => set({ unlockNeeded }),
  setDemoOpen: (demoOpen) => set({ demoOpen }),
  setMinutesOffer: (minutesOffer) => set({ minutesOffer }),
}));
