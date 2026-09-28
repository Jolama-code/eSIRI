import { useEffect, useRef } from 'react';
import { subscribeLevel } from '../audioLevel';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'acting' | 'speaking' | 'error';

/**
 * Iridescent glass sphere drawn with layered gradients (inspired by reference/orb.png).
 * The live audio level is applied as a CSS variable without re-rendering React.
 */
export function Orb({ size, state, className = '' }: { size: number; state: OrbState; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      subscribeLevel((lvl) => {
        ref.current?.style.setProperty('--level', lvl.toFixed(3));
      }),
    [],
  );
  return (
    <div ref={ref} className={`orb orb--${state} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div className="orb-glow" />
      <div className="orb-ring" />
      <div className="orb-body">
        <div className="orb-swirl" />
        <div className="orb-swirl orb-swirl-2" />
        <div className="orb-caustic" />
        <div className="orb-highlight" />
        <div className="orb-rim" />
      </div>
    </div>
  );
}
