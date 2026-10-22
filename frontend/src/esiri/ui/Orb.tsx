import { useEffect, useId, useRef } from 'react';
import { subscribeLevel } from '../audioLevel';
import './orb.css';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'acting' | 'speaking' | 'error';

/**
 * The live NURU orb: an animated version of logo/nuru-mark.svg (navy → royal → cyan glass sphere,
 * a pulsing white four-point spark, a small orange spark and two voice arcs).
 * The live audio level is applied as the CSS variable --level without re-rendering React.
 */
export function Orb({ size, state, className = '' }: { size: number; state: OrbState; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  useEffect(
    () =>
      subscribeLevel((lvl) => {
        ref.current?.style.setProperty('--level', lvl.toFixed(3));
      }),
    [],
  );
  return (
    <div ref={ref} className={`orb2 orb2--${state} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div className="orb2-glow" />
      <div className="orb2-halo" />
      <svg className="orb2-svg" viewBox="0 0 512 512">
        <defs>
          <radialGradient id={`s${uid}`} cx="0.42" cy="0.38" r="0.68">
            <stop offset="0" stopColor="#23b8ee" />
            <stop offset="0.55" stopColor="#254e96" />
            <stop offset="1" stopColor="#141b45" />
          </radialGradient>
          <radialGradient id={`g${uid}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.35" stopColor="#cef1ff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#23b8ee" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`r${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#cef1ff" />
            <stop offset="1" stopColor="#23b8ee" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <circle cx="256" cy="256" r="240" fill={`url(#s${uid})`} />
        <g className="orb2-shine">
          <circle cx="190" cy="170" r="150" fill="#23b8ee" opacity="0.18" />
        </g>
        <circle cx="256" cy="256" r="232.8" fill="none" stroke={`url(#r${uid})`} strokeWidth="8.4" />
        <path d="M112,73.6 A230.4,230.4 0 0 1 342.4,44.8" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="12" strokeLinecap="round" />
        <circle className="orb2-core" cx="256" cy="256" r="148.8" fill={`url(#g${uid})`} />
        <path
          className="orb2-spark"
          d="M256,112 C275.2,217.6 294.4,236.8 400,256 C294.4,275.2 275.2,294.4 256,400 C236.8,294.4 217.6,275.2 112,256 C217.6,236.8 236.8,217.6 256,112 Z"
          fill="#fff"
        />
        <path
          className="orb2-orange"
          d="M361.6,112 C366.4,136 371.2,140.8 395.2,145.6 C371.2,150.4 366.4,155.2 361.6,179.2 C356.8,155.2 352,150.4 328,145.6 C352,140.8 356.8,136 361.6,112 Z"
          fill="#ff6b35"
        />
        <path className="orb2-arc orb2-arc1" d="M400,198.4 A67.2,67.2 0 0 1 400,313.6" fill="none" stroke="#cef1ff" strokeOpacity="0.85" strokeWidth="12" strokeLinecap="round" />
        <path className="orb2-arc orb2-arc2" d="M424,160 A105.6,105.6 0 0 1 424,352" fill="none" stroke="#cef1ff" strokeOpacity="0.45" strokeWidth="12" strokeLinecap="round" />
      </svg>
    </div>
  );
}
