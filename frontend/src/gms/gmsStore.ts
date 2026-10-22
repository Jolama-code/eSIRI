/** GMS mock state that the agent's snapshot reads (current folder, opened e-mail, compose form). */
import { create } from 'zustand';
import { api } from '../esiri/session';

export interface MailSummary {
  id: number;
  folder: string;
  from_addr: string;
  from_name: string;
  to: { email: string; name: string }[];
  cc: { email: string; name: string }[];
  subject: string;
  sent_at: string;
  read: boolean;
  in_reply_to: number | null;
  snippet: string;
}

export interface MailFull extends MailSummary {
  body: string;
}

export interface ComposeState {
  open: boolean;
  draftId: number | null;
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** "> quoted" original when replying; appended automatically below the signature. */
  quote: string;
  inReplyTo: number | null;
  saved: 'never' | 'saving' | 'saved';
  error: string;
  sending: boolean;
}

export const emptyCompose: ComposeState = {
  open: false,
  draftId: null,
  to: '',
  cc: '',
  subject: '',
  body: '',
  quote: '',
  inReplyTo: null,
  saved: 'never',
  error: '',
  sending: false,
};

interface GmsState {
  folder: string;
  messages: MailSummary[];
  unread: number;
  drafts: number;
  loaded: boolean;
  opened: MailFull | null;
  compose: ComposeState;
  load: (folder: string) => Promise<void>;
  open: (id: number) => Promise<void>;
  closeMessage: () => void;
  setCompose: (patch: Partial<ComposeState>) => void;
  resetCompose: () => void;
}

export const useGms = create<GmsState>()((set, get) => ({
  folder: 'inbox',
  messages: [],
  unread: 0,
  drafts: 0,
  loaded: false,
  opened: null,
  compose: emptyCompose,
  load: async (folder) => {
    if (folder !== get().folder) set({ loaded: false, messages: [] });
    set({ folder });
    try {
      const r = await api<{ messages: MailSummary[]; unread: number; drafts: number }>(`/api/mail?folder=${encodeURIComponent(folder)}`);
      if (get().folder === folder) set({ messages: r.messages, unread: r.unread, drafts: r.drafts, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  open: async (id) => {
    try {
      const m = await api<MailFull>(`/api/mail/${id}`);
      set({ opened: m });
      if (!m.read) {
        await api(`/api/mail/${id}/read`, { method: 'POST' });
        set((s) => ({
          messages: s.messages.map((x) => (x.id === id ? { ...x, read: true } : x)),
          unread: Math.max(0, s.unread - (m.folder === 'inbox' ? 1 : 0)),
        }));
      }
    } catch {
      set({ opened: null });
    }
  },
  closeMessage: () => set({ opened: null }),
  setCompose: (patch) => set((s) => ({ compose: { ...s.compose, ...patch } })),
  resetCompose: () => set({ compose: emptyCompose }),
}));

export function splitAddrs(v: string): string[] {
  return v
    .split(/[,;\s]+/)
    .map((x) => x.trim().replace(/^<|>$/g, '').toLowerCase())
    .filter(Boolean);
}
