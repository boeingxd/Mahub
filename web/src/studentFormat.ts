import type { ClassLine } from './api';

// How the student screens write what the API sends. Formatting only: every
// number (rates, counts) arrives ready from the database.

// "91.7%", or "—" while there is nothing to divide by yet (not "0%").
export const rateText = (ratePct: number | null) => (ratePct === null ? '—' : `${ratePct}%`);

// "10 of 11": the sessions that count towards the rate. An excused window is
// left out of both the rate and this count, so they always agree. "—" before
// the class has held a window.
export function sessionsCount(c: Pick<ClassLine, 'attended' | 'sessions_held' | 'sessions_counted'>) {
  return c.sessions_held === 0 ? '—' : `${c.attended} of ${c.sessions_counted ?? c.sessions_held}`;
}

// "Fri 9 Oct", in the viewer's time zone (like the instructor's summary).
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// "09:01": 24 h, in the viewer's time zone.
export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
