/**
 * The ghost cursor: a fixed-position SVG pointer with an "eSiri" bubble,
 * a highlight ring around the target and a click ripple. Pure DOM, above everything.
 */
import { sleep } from './util';

let root: HTMLDivElement | null = null;
let pointer: HTMLDivElement | null = null;
let ring: HTMLDivElement | null = null;
let pos = { x: -100, y: -100 };
let visible = false;

const POINTER_SVG = `
<svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true">
  <defs>
    <linearGradient id="esiri-cur-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7fd8ff"/>
      <stop offset="0.5" stop-color="#b59cff"/>
      <stop offset="1" stop-color="#ff9ad5"/>
    </linearGradient>
  </defs>
  <path d="M3 2 L3 26 L9.5 20 L14 31 L18.5 29 L14 18.5 L23 18.5 Z"
        fill="url(#esiri-cur-g)" stroke="#1B2A5E" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

function ensure(): void {
  if (root) return;
  root = document.createElement('div');
  root.className = 'esiri-cursor-layer';
  root.setAttribute('aria-hidden', 'true');

  ring = document.createElement('div');
  ring.className = 'esiri-ring';
  root.appendChild(ring);

  pointer = document.createElement('div');
  pointer.className = 'esiri-pointer';
  pointer.innerHTML = `${POINTER_SVG}<span class="esiri-pointer-label">eSiri</span>`;
  root.appendChild(pointer);

  document.body.appendChild(root);
}

function place(): void {
  if (pointer) pointer.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
}

export function showCursor(label = 'eSiri'): void {
  ensure();
  const lbl = pointer!.querySelector('.esiri-pointer-label');
  if (lbl) lbl.textContent = label;
  if (!visible) {
    // Enter from the bottom centre (where the big orb floats).
    pos = { x: window.innerWidth / 2, y: window.innerHeight - 150 };
    place();
    visible = true;
  }
  root!.classList.add('visible');
}

export function hideCursor(): void {
  visible = false;
  clearHighlight();
  root?.classList.remove('visible');
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function glideTo(x: number, y: number, signal: AbortSignal): Promise<void> {
  ensure();
  const from = { ...pos };
  const dist = Math.hypot(x - from.x, y - from.y);
  const duration = Math.min(700, Math.max(500, 380 + dist * 0.35));
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const step = (now: number) => {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      pos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      place();
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function highlight(el: Element): void {
  ensure();
  const r = el.getBoundingClientRect();
  const pad = 5;
  ring!.style.left = `${r.left - pad}px`;
  ring!.style.top = `${r.top - pad}px`;
  ring!.style.width = `${r.width + pad * 2}px`;
  ring!.style.height = `${r.height + pad * 2}px`;
  ring!.classList.add('on');
}

export function clearHighlight(): void {
  ring?.classList.remove('on');
}

export function ripple(x: number, y: number): void {
  ensure();
  const d = document.createElement('div');
  d.className = 'esiri-ripple';
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  root!.appendChild(d);
  window.setTimeout(() => d.remove(), 650);
}

/** Press animation on the pointer. */
export async function press(signal: AbortSignal): Promise<void> {
  pointer?.classList.add('pressing');
  await sleep(120, signal).finally(() => pointer?.classList.remove('pressing'));
}
