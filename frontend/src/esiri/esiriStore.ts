import { create } from 'zustand';

export type Status =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'acting'
  | 'speaking'
  | 'awaiting_confirmation'
  | 'awaiting_answer';

export type Msg =
  | { id: string; kind: 'user'; text: string; mode: 'voice' | 'text' }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'step'; text: string; status: 'pending' | 'ok' | 'fail'; icon: StepIcon }
  | { id: string; kind: 'confirm'; summary: string; state: 'pending' | 'approved' | 'declined' }
  | { id: string; kind: 'notice'; text: string; tone: 'error' | 'info' };

export type StepIcon = 'click' | 'type' | 'tab' | 'toggle' | 'navigate' | 'language' | 'blocked' | 'select' | 'moderator' | 'reminder' | 'katibu';

export interface Health {
  reachable: boolean;
  has_key: boolean;
  model: string;
  english_tts: 'browser' | 'openai';
}

interface EsiriState {
  panelOpen: boolean;
  status: Status;
  /** Microphone is open (for orb visuals; status may be awaiting_confirmation meanwhile). */
  micOpen: boolean;
  interim: string;
  messages: Msg[];
  health: Health | null;
  errorFlash: number;
  wakeRunning: boolean;
  sttNoticeShown: boolean;

  setPanelOpen: (open: boolean) => void;
  setStatus: (s: Status) => void;
  setMicOpen: (open: boolean) => void;
  setInterim: (s: string) => void;
  addMsg: (m: DistributiveOmit<Msg, 'id'>) => string;
  patchMsg: (id: string, patch: Partial<Msg>) => void;
  clearMessages: () => void;
  setHealth: (h: Health) => void;
  flashError: () => void;
  setWakeRunning: (on: boolean) => void;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let counter = 0;

export const useEsiri = create<EsiriState>()((set) => ({
  panelOpen: false,
  status: 'idle',
  micOpen: false,
  interim: '',
  messages: [],
  health: null,
  errorFlash: 0,
  wakeRunning: false,
  sttNoticeShown: false,

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setStatus: (status) => set({ status }),
  setMicOpen: (micOpen) => set({ micOpen }),
  setInterim: (interim) => set({ interim }),
  addMsg: (m) => {
    const id = `m${++counter}`;
    set((s) => ({ messages: [...s.messages, { ...m, id } as Msg] }));
    return id;
  },
  patchMsg: (id, patch) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as Msg) : m)) })),
  clearMessages: () => set({ messages: [] }),
  setHealth: (health) => set({ health }),
  flashError: () => set({ errorFlash: Date.now() }),
  setWakeRunning: (wakeRunning) => set({ wakeRunning }),
}));
