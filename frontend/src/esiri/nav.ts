import type { NavigateFunction } from 'react-router-dom';

let navigateFn: NavigateFunction | null = null;

export function setNavigator(fn: NavigateFunction): void {
  navigateFn = fn;
}

export function goTo(path: string): void {
  if (navigateFn) navigateFn(path);
  else window.history.pushState({}, '', path);
}

export type SystemName = 'hub' | 'mikutano' | 'gms' | 'weris';

export type MikutanoPage = 'landing' | 'rooms' | 'recordings' | 'room' | 'meeting' | 'audit';
export type PageName =
  | MikutanoPage
  | 'hub_login' | 'hub_today' | 'hub_tasks' | 'hub_meetings' | 'hub_minutes' | 'hub_minutes_detail'
  | 'hub_notifications' | 'hub_systems' | 'hub_activity' | 'hub_settings'
  | 'gms_login' | 'gms_inbox' | 'gms_drafts' | 'gms_sent' | 'gms_trash' | 'gms_junk' | 'gms_read' | 'gms_compose'
  | 'weris_dashboard' | 'weris_projects' | 'weris_pdp' | 'weris_tasks' | 'weris_reports';

/** Pages the agent may navigate to directly, with their paths. */
export const NAV_PAGES: Record<string, string> = {
  hub_today: '/hub',
  hub_tasks: '/hub/tasks',
  hub_meetings: '/hub/meetings',
  hub_minutes: '/hub/minutes',
  hub_notifications: '/hub/notifications',
  hub_systems: '/hub/systems',
  hub_activity: '/hub/activity',
  hub_settings: '/hub/settings',
  gms_inbox: '/gms/inbox',
  gms_drafts: '/gms/drafts',
  gms_sent: '/gms/sent',
  gms_compose: '/gms/compose',
  weris_dashboard: '/weris',
  weris_projects: '/weris/projects',
  weris_pdp: '/weris/pdp',
  weris_tasks: '/weris/tasks',
  weris_reports: '/weris/reports',
  landing: '/',
  rooms: '/rooms',
  recordings: '/recordings',
  audit: '/audit',
};

export function systemFromPath(pathname: string): SystemName {
  if (pathname.startsWith('/hub')) return 'hub';
  if (pathname.startsWith('/gms')) return 'gms';
  if (pathname.startsWith('/weris')) return 'weris';
  return 'mikutano';
}

export function pageFromPath(pathname: string): PageName {
  if (pathname.startsWith('/hub')) {
    if (pathname.startsWith('/hub/login')) return 'hub_login';
    if (/^\/hub\/minutes\/[^/]+/.test(pathname)) return 'hub_minutes_detail';
    const sub = pathname.split('/')[2] ?? '';
    const map: Record<string, PageName> = {
      tasks: 'hub_tasks', meetings: 'hub_meetings', minutes: 'hub_minutes', notifications: 'hub_notifications',
      systems: 'hub_systems', activity: 'hub_activity', settings: 'hub_settings',
    };
    return map[sub] ?? 'hub_today';
  }
  if (pathname.startsWith('/gms')) {
    if (pathname.startsWith('/gms/login')) return 'gms_login';
    if (pathname.startsWith('/gms/compose')) return 'gms_compose';
    if (/^\/gms\/[^/]+\/\d+/.test(pathname)) return 'gms_read';
    const folder = pathname.split('/')[2] ?? 'inbox';
    const map: Record<string, PageName> = { drafts: 'gms_drafts', sent: 'gms_sent', trash: 'gms_trash', junk: 'gms_junk' };
    return map[folder] ?? 'gms_inbox';
  }
  if (pathname.startsWith('/weris')) {
    const sub = pathname.split('/')[2] ?? '';
    const map: Record<string, PageName> = { projects: 'weris_projects', pdp: 'weris_pdp', tasks: 'weris_tasks', reports: 'weris_reports' };
    return map[sub] ?? 'weris_dashboard';
  }
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
