import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { currentPerson } from '../esiri/session';

export type Language = 'en' | 'sw';

export interface RoomSettings {
  muteOnJoin: boolean;
  requireApproval: boolean;
  anyoneCanStart: boolean;
  allModerators: boolean;
  allowRecording: boolean;
}

export type SettingKey = keyof RoomSettings;

export interface PresFile {
  id: string;
  name: string;
  size: number;
  source: 'upload' | 'eoffice';
  docId?: string;
}

export interface Room {
  id: string;
  name: string;
  token: string;
  lastSession: string | null;
  createdAt: string;
  settings: RoomSettings;
  viewerCode: string | null;
  moderatorCode: string | null;
  sharedUsers: string[];
  presentation: PresFile[];
}

export interface Recording {
  id: string;
  roomId: string;
  name: string;
  date: string;
  durationSec: number;
}

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  time: string;
}

export interface MeetingData {
  chat: ChatMessage[];
  notes: string;
}

export interface LobbyPerson {
  id: string;
  name: string;
  /** when they started knocking (ms) */
  at: number;
}

export interface LiveMeeting {
  roomId: string;
  /** NURU moderator mode: NURU admits people from the lobby on the user's behalf. */
  moderator: boolean;
  lobby: LobbyPerson[];
  /** People admitted into the meeting (besides the user). */
  participants: LobbyPerson[];
  /** Names admitted while moderator mode was on (for the hand-back summary). */
  admittedWhileModerating: string[];
  recording: boolean;
  recordingStartedAt: number | null;
  mic: boolean;
  camera: boolean;
  screenShare: boolean;
  handRaised: boolean;
  panel: 'chat' | 'notes';
}

export interface Toast {
  id: string;
  text: string;
}

export type Outcome = 'Completed' | 'Declined' | 'Cancelled' | 'Failed';

export interface AuditStep {
  time: string;
  tool: string;
  target: string;
  text?: string;
  ok: boolean;
  error?: string;
}

export interface AuditConfirmation {
  summary: string;
  result: 'approved' | 'declined' | 'changed';
}

export interface AuditRecord {
  id: string;
  system?: 'hub' | 'mikutano' | 'gms' | 'weris' | 'katibu';
  timestamp: string;
  user: string;
  language: Language;
  inputMode: 'voice' | 'text' | 'auto';
  request: string;
  steps: AuditStep[];
  confirmations: AuditConfirmation[];
  outcome: Outcome;
  finalMessage: string;
  durationMs: number;
}

interface PersistedState {
  language: Language;
  signedIn: boolean;
  sessionId: string;
  rooms: Room[];
  recordings: Recording[];
  meetings: Record<string, MeetingData>;
  audit: AuditRecord[];
  wakeMode: boolean;
}

interface AppState extends PersistedState {
  toasts: Toast[];
  live: LiveMeeting | null;

  setLanguage: (lang: Language) => void;
  signIn: () => void;
  signOut: () => void;
  resetDemo: () => void;
  setWakeMode: (on: boolean) => void;
  newSession: () => void;

  createRoom: (name: string) => Room;
  renameRoom: (roomId: string, name: string) => void;
  deleteRoom: (roomId: string) => void;
  setSetting: (roomId: string, key: SettingKey, value: boolean) => void;
  generateCode: (roomId: string, kind: 'viewer' | 'moderator') => string;
  deleteCode: (roomId: string, kind: 'viewer' | 'moderator') => void;
  addSharedUser: (roomId: string, userId: string) => void;
  removeSharedUser: (roomId: string, userId: string) => void;
  addPresentation: (roomId: string, file: Omit<PresFile, 'id'>) => void;
  removePresentation: (roomId: string, fileId: string) => void;
  deleteRecording: (recId: string) => void;

  ensureSeedRooms: (displayName: string) => void;
  startMeeting: (roomId: string) => void;
  updateLive: (patch: Partial<LiveMeeting>) => void;
  startRecording: () => void;
  stopRecording: () => Recording | null;
  leaveMeeting: () => void;
  sendChat: (roomId: string, text: string) => void;
  setNotes: (roomId: string, notes: string) => void;

  toast: (text: string) => void;
  dismissToast: (id: string) => void;

  addAudit: (rec: AuditRecord) => void;
  clearAudit: () => void;
}

// ---------------------------------------------------------------------------
// helpers

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(len = 4, alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'): string {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'room';
}

function makeToken(name: string, existing: Set<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  let prefix = (letters[0] ?? '') + letters.slice(1).replace(/[AEIOU]/g, '');
  prefix = (prefix + 'XXX').slice(0, 3);
  let token = '';
  do token = `${prefix}-${randomId(4, ALNUM)}`;
  while (existing.has(token));
  return token;
}

function sixDigits(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

export const DEFAULT_SETTINGS: RoomSettings = {
  muteOnJoin: false,
  requireApproval: false,
  anyoneCanStart: false,
  allModerators: false,
  allowRecording: true,
};

export function formatDateLong(iso: string, lang: Language): string {
  return new Date(iso).toLocaleDateString(lang === 'sw' ? 'sw-TZ' : 'en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(iso: string, lang: Language): string {
  return new Date(iso).toLocaleTimeString(lang === 'sw' ? 'sw-TZ' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const SEED_ROOM_ID = 'jolamas-room-r7k2';
export const KAMATI_ROOM_ID = 'kamati-ya-bajeti-k7b2';

function kamatiRoom(): Room {
  return {
    id: KAMATI_ROOM_ID,
    name: 'Kamati ya Bajeti',
    token: 'KMT-B7K2',
    lastSession: null,
    createdAt: new Date(2026, 9, 1, 9, 0).toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    viewerCode: null,
    moderatorCode: null,
    sharedUsers: [],
    presentation: [{ id: 'f-agenda-kmt', name: 'Meeting_Agenda.pdf', size: 184_320, source: 'eoffice', docId: 'meeting-agenda' }],
  };
}

function seedData(): Pick<PersistedState, 'rooms' | 'recordings' | 'meetings'> {
  const last = new Date(2026, 8, 25, 11, 11).toISOString();
  const recStart = new Date(2026, 8, 25, 10, 36).toISOString();
  const me = currentPerson().name;
  return {
    rooms: [
      {
        id: SEED_ROOM_ID,
        name: `${me}'s Room`,
        token: 'JLM-7K2Q',
        lastSession: last,
        createdAt: new Date(2026, 8, 1, 9, 0).toISOString(),
        settings: { ...DEFAULT_SETTINGS },
        viewerCode: null,
        moderatorCode: null,
        sharedUsers: [],
        presentation: [],
      },
      kamatiRoom(),
    ],
    recordings: [
      {
        id: 'rec-seed-9f3a',
        roomId: SEED_ROOM_ID,
        name: `${me}'s Room – September 25, 2026`,
        date: recStart,
        durationSec: 32 * 60,
      },
    ],
    meetings: {},
  };
}

function newSessionId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `s-${Date.now()}-${randomId(10)}`;
}

function initialPersisted(): PersistedState {
  return {
    language: 'sw',
    signedIn: false,
    sessionId: newSessionId(),
    audit: [],
    wakeMode: false,
    ...seedData(),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------

export const useApp = create<AppState>()(
  persist(
    (set, get) => {
      const patchRoom = (roomId: string, fn: (r: Room) => Room) =>
        set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? fn(r) : r)) }));

      return {
        ...initialPersisted(),
        toasts: [],
        live: null,

        setLanguage: (language) => {
          set({ language });
          document.documentElement.lang = language;
        },
        signIn: () => set({ signedIn: true }),
        signOut: () => set({ signedIn: false, live: null }),
        resetDemo: () =>
          set((s) => ({
            ...seedData(),
            audit: [],
            live: null,
            toasts: [],
            signedIn: true,
            sessionId: newSessionId(),
            language: s.language,
          })),
        setWakeMode: (wakeMode) => set({ wakeMode }),
        newSession: () => set({ sessionId: newSessionId() }),

        createRoom: (rawName) => {
          const name = rawName.trim();
          const existingIds = new Set(get().rooms.map((r) => r.id));
          let id = '';
          do id = `${slugify(name)}-${randomId(4)}`;
          while (existingIds.has(id));
          const room: Room = {
            id,
            name,
            token: makeToken(name, new Set(get().rooms.map((r) => r.token))),
            lastSession: null,
            createdAt: nowIso(),
            settings: { ...DEFAULT_SETTINGS },
            viewerCode: null,
            moderatorCode: null,
            sharedUsers: [],
            presentation: [],
          };
          set((s) => ({ rooms: [...s.rooms, room] }));
          return room;
        },
        renameRoom: (roomId, name) => patchRoom(roomId, (r) => ({ ...r, name: name.trim() || r.name })),
        deleteRoom: (roomId) =>
          set((s) => {
            const meetings = { ...s.meetings };
            delete meetings[roomId];
            return {
              rooms: s.rooms.filter((r) => r.id !== roomId),
              recordings: s.recordings.filter((r) => r.roomId !== roomId),
              meetings,
              live: s.live?.roomId === roomId ? null : s.live,
            };
          }),
        setSetting: (roomId, key, value) =>
          patchRoom(roomId, (r) => ({ ...r, settings: { ...r.settings, [key]: value } })),
        generateCode: (roomId, kind) => {
          const code = sixDigits();
          patchRoom(roomId, (r) => (kind === 'viewer' ? { ...r, viewerCode: code } : { ...r, moderatorCode: code }));
          return code;
        },
        deleteCode: (roomId, kind) =>
          patchRoom(roomId, (r) => (kind === 'viewer' ? { ...r, viewerCode: null } : { ...r, moderatorCode: null })),
        addSharedUser: (roomId, userId) =>
          patchRoom(roomId, (r) =>
            r.sharedUsers.includes(userId) ? r : { ...r, sharedUsers: [...r.sharedUsers, userId] },
          ),
        removeSharedUser: (roomId, userId) =>
          patchRoom(roomId, (r) => ({ ...r, sharedUsers: r.sharedUsers.filter((u) => u !== userId) })),
        addPresentation: (roomId, file) =>
          patchRoom(roomId, (r) => ({ ...r, presentation: [...r.presentation, { ...file, id: `f-${randomId(6)}` }] })),
        removePresentation: (roomId, fileId) =>
          patchRoom(roomId, (r) => ({ ...r, presentation: r.presentation.filter((f) => f.id !== fileId) })),
        deleteRecording: (recId) => set((s) => ({ recordings: s.recordings.filter((r) => r.id !== recId) })),

        ensureSeedRooms: (displayName) =>
          set((s) => {
            let rooms = s.rooms;
            const seed = rooms.find((r) => r.id === SEED_ROOM_ID);
            // The personal seed room carries the signed-in user's name ("{name}'s Room").
            if (seed && /'s Room$/.test(seed.name) && seed.name !== `${displayName}'s Room`) {
              rooms = rooms.map((r) => (r.id === SEED_ROOM_ID ? { ...r, name: `${displayName}'s Room` } : r));
            }
            if (!rooms.some((r) => r.id === KAMATI_ROOM_ID)) rooms = [...rooms, kamatiRoom()];
            return rooms === s.rooms ? {} : { rooms };
          }),
        startMeeting: (roomId) => {
          const room = get().rooms.find((r) => r.id === roomId);
          if (!room) return;
          if (get().live?.roomId === roomId) return;
          patchRoom(roomId, (r) => ({ ...r, lastSession: nowIso() }));
          set({
            live: {
              roomId,
              recording: false,
              recordingStartedAt: null,
              mic: !room.settings.muteOnJoin,
              moderator: false,
              lobby: [],
              participants: [],
              admittedWhileModerating: [],
              camera: false,
              screenShare: false,
              handRaised: false,
              panel: 'chat',
            },
          });
        },
        updateLive: (patch) => set((s) => (s.live ? { live: { ...s.live, ...patch } } : {})),
        startRecording: () =>
          set((s) => (s.live ? { live: { ...s.live, recording: true, recordingStartedAt: Date.now() } } : {})),
        stopRecording: () => {
          const { live, rooms, language } = get();
          if (!live || !live.recording || live.recordingStartedAt == null) return null;
          const room = rooms.find((r) => r.id === live.roomId);
          const startedAt = live.recordingStartedAt;
          const rec: Recording = {
            id: `rec-${randomId(6)}`,
            roomId: live.roomId,
            name: `${room?.name ?? 'Room'} – ${formatDateLong(new Date(startedAt).toISOString(), language)}`,
            date: new Date(startedAt).toISOString(),
            durationSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          };
          set((s) => ({
            recordings: [...s.recordings, rec],
            live: s.live ? { ...s.live, recording: false, recordingStartedAt: null } : null,
          }));
          return rec;
        },
        leaveMeeting: () => {
          const { live } = get();
          if (!live) return;
          if (live.recording) get().stopRecording();
          patchRoom(live.roomId, (r) => ({ ...r, lastSession: nowIso() }));
          set({ live: null });
        },
        sendChat: (roomId, text) => {
          const clean = text.trim();
          if (!clean) return;
          set((s) => {
            const m = s.meetings[roomId] ?? { chat: [], notes: '' };
            const msg: ChatMessage = { id: randomId(8), author: currentPerson().name, text: clean, time: nowIso() };
            return { meetings: { ...s.meetings, [roomId]: { ...m, chat: [...m.chat, msg] } } };
          });
        },
        setNotes: (roomId, notes) =>
          set((s) => {
            const m = s.meetings[roomId] ?? { chat: [], notes: '' };
            return { meetings: { ...s.meetings, [roomId]: { ...m, notes } } };
          }),

        toast: (text) => {
          const id = randomId(6);
          set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
          window.setTimeout(() => get().dismissToast(id), 5000);
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

        addAudit: (rec) => set((s) => ({ audit: [rec, ...s.audit].slice(0, 500) })),
        clearAudit: () => set({ audit: [] }),
      };
    },
    {
      name: 'emikutano-store',
      version: 2,
      migrate: (persisted, version) => {
        const st = persisted as PersistedState;
        if (version < 2 && st && Array.isArray(st.rooms) && !st.rooms.some((r) => r.id === KAMATI_ROOM_ID)) {
          st.rooms = [...st.rooms, kamatiRoom()];
        }
        return st;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s): PersistedState => ({
        language: s.language,
        signedIn: s.signedIn,
        sessionId: s.sessionId,
        rooms: s.rooms,
        recordings: s.recordings,
        meetings: s.meetings,
        audit: s.audit,
        wakeMode: s.wakeMode,
      }),
    },
  ),
);

export function getRoom(roomId: string | undefined): Room | undefined {
  if (!roomId) return undefined;
  return useApp.getState().rooms.find((r) => r.id === roomId);
}
