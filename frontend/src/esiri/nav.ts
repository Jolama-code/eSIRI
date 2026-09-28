import type { NavigateFunction } from 'react-router-dom';

let navigateFn: NavigateFunction | null = null;

export function setNavigator(fn: NavigateFunction): void {
  navigateFn = fn;
}

export function goTo(path: string): void {
  if (navigateFn) navigateFn(path);
  else window.history.pushState({}, '', path);
}

export type PageName = 'landing' | 'rooms' | 'recordings' | 'room' | 'meeting' | 'audit';

export function pageFromPath(pathname: string): PageName {
  if (/^\/rooms\/[^/]+\/meeting\/?$/.test(pathname)) return 'meeting';
  if (/^\/rooms\/[^/]+\/?$/.test(pathname)) return 'room';
  if (pathname.startsWith('/rooms')) return 'rooms';
  if (pathname.startsWith('/recordings')) return 'recordings';
  if (pathname.startsWith('/audit')) return 'audit';
  return 'landing';
}

export function roomIdFromPath(pathname: string): string | undefined {
  const m = /^\/rooms\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : undefined;
}
