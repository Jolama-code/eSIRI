/**
 * The "hands": executes click / type_text / navigate visibly with the ghost cursor.
 * Never throws for UI problems: returns {ok:false, error}. Only cancellation throws.
 */
import { clearHighlight, glideTo, highlight, press, ripple, showCursor } from './cursor';
import { describeElement, isDisabled, isReachable, isVisible, openModalEl } from './snapshot';
import { goTo, pageFromPath, type PageName } from './nav';
import { nextFrames, sleep } from './util';
import { useApp } from '../store/appStore';

export interface ActionResult {
  ok: boolean;
  error?: string;
  code?: 'not_found' | 'disabled' | 'confirmation_required' | 'not_editable' | 'invalid';
  [k: string]: unknown;
}

export interface DriverContext {
  signal: AbortSignal;
  /** Is there an unused confirmation credit? */
  hasCredit: () => boolean;
  /** Use one confirmation credit. */
  useCredit: () => void;
  /** How long to wait for an element to appear (predicted ids later in a batch). */
  appearWaitMs?: number;
}

function query(id: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-esiri-id="${CSS.escape(id)}"]`);
  for (const el of all) if (isVisible(el) && !el.closest('.esiri-panel')) return el;
  return null;
}

/** Find an element, waiting briefly for it to appear (predicted ids in a batch). */
async function find(id: string, signal: AbortSignal, waitMs = 1500): Promise<HTMLElement | null> {
  const deadline = performance.now() + waitMs;
  for (;;) {
    const el = query(id);
    if (el) return el;
    if (performance.now() > deadline) return null;
    await sleep(100, signal);
  }
}

/** Wait briefly for an element; used to skip stale predictions after a page change. */
export async function elementPresent(id: string, signal: AbortSignal): Promise<boolean> {
  return (await find(id, signal)) !== null;
}

function notFound(id: string): ActionResult {
  const modal = openModalEl()?.getAttribute('data-esiri-modal');
  return {
    ok: false,
    code: 'not_found',
    error: `Element "${id}" is not on the screen${modal ? ` (the "${modal}" modal is open)` : ''}. Use an id from the latest snapshot.`,
  };
}

async function settle(signal: AbortSignal, pathBefore: string): Promise<void> {
  await sleep(350, signal);
  await nextFrames(2);
  if (window.location.pathname !== pathBefore) {
    await sleep(250, signal);
    await nextFrames(2);
  }
}

async function approach(el: HTMLElement, signal: AbortSignal): Promise<{ x: number; y: number }> {
  showCursor();
  const before = el.getBoundingClientRect();
  const inView = before.top >= 60 && before.bottom <= window.innerHeight - 60;
  if (!inView) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // wait for the smooth scroll to settle
    let last = el.getBoundingClientRect().top;
    for (let i = 0; i < 12; i++) {
      await sleep(60, signal);
      const now = el.getBoundingClientRect().top;
      if (Math.abs(now - last) < 0.5) break;
      last = now;
    }
  }
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  await glideTo(x, y, signal);
  highlight(el);
  return { x, y };
}

export async function click(id: string, ctx: DriverContext): Promise<ActionResult> {
  const el = await find(id, ctx.signal, ctx.appearWaitMs);
  if (!el) return notFound(id);
  if (!isReachable(el)) return { ok: false, code: 'not_found', error: `Element "${id}" is behind an open modal.` };
  if (isDisabled(el)) return { ok: false, code: 'disabled', error: `"${describeElement(el).label}" is disabled right now.` };
  const sensitive = el.getAttribute('data-esiri-sensitive') === 'true';
  if (sensitive && !ctx.hasCredit()) {
    return {
      ok: false,
      code: 'confirmation_required',
      error: 'confirmation_required: this is a sensitive action. Call ask_confirmation first and click again after the user approves.',
    };
  }
  const { x, y } = await approach(el, ctx.signal);
  await sleep(140, ctx.signal);
  // Re-check after the animation: the UI may have changed.
  if (!el.isConnected || isDisabled(el)) {
    clearHighlight();
    return { ok: false, code: 'not_found', error: `Element "${id}" changed before it could be clicked.` };
  }
  ripple(x, y);
  await press(ctx.signal);
  if (sensitive) ctx.useCredit();
  const pathBefore = window.location.pathname;
  el.click();
  await sleep(120, ctx.signal);
  clearHighlight();
  await settle(ctx.signal, pathBefore);
  return { ok: true };
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function typeText(id: string, text: string, ctx: DriverContext): Promise<ActionResult> {
  const el = await find(id, ctx.signal, ctx.appearWaitMs);
  if (!el) return notFound(id);
  if (!isReachable(el)) return { ok: false, code: 'not_found', error: `Element "${id}" is behind an open modal.` };
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return { ok: false, code: 'not_editable', error: `"${id}" is not a text field.` };
  }
  if (isDisabled(el) || el.readOnly) return { ok: false, code: 'disabled', error: `"${id}" cannot be edited right now.` };
  const { x, y } = await approach(el, ctx.signal);
  ripple(x, y);
  await press(ctx.signal);
  el.focus();
  el.click();
  setNativeValue(el, '');
  await sleep(80, ctx.signal);
  let cur = '';
  for (const ch of Array.from(text)) {
    cur += ch;
    setNativeValue(el, cur);
    await sleep(35, ctx.signal);
  }
  clearHighlight();
  await settle(ctx.signal, window.location.pathname);
  if (el.isConnected && el.value !== text) {
    return { ok: false, error: `The field "${id}" contains "${el.value}" instead of the requested text.` };
  }
  return { ok: true };
}

export async function navigate(page: string, roomId: string | undefined, ctx: DriverContext): Promise<ActionResult> {
  const pages: PageName[] = ['landing', 'rooms', 'recordings', 'audit', 'room', 'meeting'];
  if (!pages.includes(page as PageName)) return { ok: false, code: 'invalid', error: `Unknown page "${page}".` };
  const current = pageFromPath(window.location.pathname);
  if (current === 'meeting' && page !== 'meeting') {
    return { ok: false, code: 'invalid', error: 'You are in a meeting. Use meeting.leave (after confirmation) to leave it.' };
  }
  const { rooms, signedIn, signIn } = useApp.getState();
  let path = '/';
  if (page === 'room' || page === 'meeting') {
    if (!roomId) return { ok: false, code: 'invalid', error: `navigate to "${page}" needs room_id.` };
    if (!rooms.some((r) => r.id === roomId)) {
      return { ok: false, code: 'invalid', error: `No room with id "${roomId}". Known ids: ${rooms.map((r) => r.id).join(', ')}` };
    }
    if (page === 'meeting') {
      if (!ctx.hasCredit()) {
        return {
          ok: false,
          code: 'confirmation_required',
          error: 'confirmation_required: starting a meeting is sensitive. Call ask_confirmation first.',
        };
      }
      ctx.useCredit();
    }
    path = page === 'room' ? `/rooms/${roomId}` : `/rooms/${roomId}/meeting`;
  } else if (page === 'rooms') path = '/rooms';
  else if (page === 'recordings') path = '/recordings';
  else if (page === 'audit') path = '/audit';
  if (page !== 'landing' && !signedIn) signIn();
  const before = window.location.pathname;
  goTo(path);
  await settle(ctx.signal, before);
  return { ok: true };
}
