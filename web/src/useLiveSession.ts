import { useEffect, useRef } from 'react';
import { useApi, type ClassSession, type MySection, type Roster, type RosterStudent } from './api';
import type { RosterRow } from './pages/RosterPage';
import { watchRoster } from './realtime';

// Everything the live-session and projector screens need about one check-in
// window. The session says which section it belongs to, and /my/sections has
// that section's name and size. The roster is pushed live (realtime.ts: the API
// says "something changed" and we ask for the roster again). The slow 30 s
// refresh is the safety net if the WebSocket can't connect.
export function useLiveSession(id: string) {
  const session = useApi<ClassSession>(`/class-sessions/${id}`);
  const sections = useApi<MySection[]>('/my/sections');
  const roster = useApi<Roster>(`/class-sessions/${id}/roster`, 30_000);

  // roster.refresh is a new function on every render; the ref keeps the
  // WebSocket from being closed and reopened each time.
  const refreshRoster = useRef(roster.refresh);
  useEffect(() => {
    refreshRoster.current = roster.refresh;
  });
  useEffect(() => watchRoster(id, () => refreshRoster.current()), [id]);

  const [a, b] = [session.state, sections.state];
  const section = a.status === 'done' && b.status === 'done' ? b.data.find((s) => s.id === a.data.section_id) : undefined;
  const retry = () => [session, sections, roster].forEach((r) => r.retry());
  return { session, sections, roster, section, retry };
}

// A time of day as the screens show it: 24 h, in the viewer's time zone.
export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

// The API's roster rows, in the shape the roster table draws.
export const toRosterRows = (students: RosterStudent[]): RosterRow[] =>
  students.map((s) => ({
    studentId: s.student_id,
    studentNo: s.student_no,
    name: s.full_name,
    status: s.status,
    time: s.recorded_at ? hhmm(s.recorded_at) : undefined,
    manual: s.method === 'manual',
  }));
