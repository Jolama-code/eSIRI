/** Small building blocks of the NURU Hub look (design-system tokens, Font Awesome solid icons in shapes). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { Language } from '../store/appStore';

export const TZ = 'Africa/Dar_es_Salaam';

export function Fa({ icon, className = '', title }: { icon: IconDefinition; className?: string; title?: string }) {
  return <FontAwesomeIcon icon={icon} className={className} title={title} fixedWidth />;
}

/** Icons always sit in a shape (circle or rounded tile), as the brand book says. */
export function IconShape({
  icon,
  tone = 'navy',
  shape = 'circle',
  size = 40,
}: {
  icon: IconDefinition;
  tone?: 'navy' | 'royal' | 'cyan' | 'orange' | 'frost' | 'white' | 'green' | 'red';
  shape?: 'circle' | 'tile';
  size?: number;
}) {
  return (
    <span className={`ishape ishape-${tone} ishape-${shape}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      <FontAwesomeIcon icon={icon} />
    </span>
  );
}

export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="t-num">{shown}</span>;
}

export function Skeleton({ h = 18, w = '100%', r = 10 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ display: 'block', height: h, width: w, borderRadius: r }} />;
}

export function Card({ children, className = '', i = 0, testid }: { children: ReactNode; className?: string; i?: number; testid?: string }) {
  return (
    <section className={`hcard rise ${className}`} style={{ ['--i' as string]: i }} data-testid={testid}>
      {children}
    </section>
  );
}

export function Empty({ icon, text }: { icon: IconDefinition; text: string }) {
  return (
    <div className="hempty">
      <IconShape icon={icon} tone="frost" size={48} />
      <p>{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time (always shown in Tanzanian time, whatever the device's zone)

function parts(iso: string): Record<string, string> {
  const d = new Date(iso);
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d)) out[p.type] = p.value;
  if (out.hour === '24') out.hour = '00';
  return out;
}

export function hm(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}

export function localDate(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

export function todayLocal(): string {
  return localDate(new Date().toISOString());
}

export function localHour(): number {
  return Number(parts(new Date().toISOString()).hour);
}

export function longDate(iso: string, lang: Language): string {
  return new Date(iso).toLocaleDateString(lang === 'sw' ? 'sw-TZ' : 'en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function shortDate(iso: string, lang: Language): string {
  return new Date(iso).toLocaleDateString(lang === 'sw' ? 'sw-TZ' : 'en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
}

export function dateTime(iso: string | null | undefined, lang: Language): string {
  if (!iso) return '';
  return `${shortDate(iso, lang)} · ${hm(iso)}`;
}

/** "mm:ss" or "h:mm:ss" until the given time (negative → '00:00'). */
export function countdown(iso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const SW_NUM = ['', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa', 'kumi', 'kumi na moja', 'kumi na mbili'];

/** 24 h "14:00" → "saa nane mchana" (spoken Swahili time). */
export function swClock(hhmm: string): string {
  const [hs, ms] = hhmm.split(':');
  let h = Number(hs);
  const m = Number(ms);
  let less = false;
  if (m >= 45) {
    h = (h + 1) % 24;
    less = true;
  }
  const word = SW_NUM[(h + 6) % 12 || 12];
  const period = h >= 4 && h <= 6 ? 'alfajiri' : h >= 7 && h <= 11 ? 'asubuhi' : h >= 12 && h <= 15 ? 'mchana' : h >= 16 && h <= 18 ? 'jioni' : 'usiku';
  if (less) return `saa ${word} ${m === 45 ? 'kasoro robo' : `kasoro dakika ${60 - m}`} ${period}`;
  if (m === 0) return `saa ${word} ${period}`;
  if (m === 30) return `saa ${word} na nusu ${period}`;
  if (m === 15) return `saa ${word} na robo ${period}`;
  return `saa ${word} na dakika ${m} ${period}`;
}

export function enClock(hhmm: string): string {
  const [hs, ms] = hhmm.split(':');
  const h = Number(hs);
  return `${h % 12 || 12}:${ms} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

export function spokenClock(hhmm: string, lang: Language): string {
  return lang === 'sw' ? swClock(hhmm) : enClock(hhmm);
}
