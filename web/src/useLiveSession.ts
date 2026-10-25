import { useApi, type ClassSession, type MySection, type Roster, type RosterStudent } from './api';
import type { RosterRow } from './pages/RosterPage';

// Everything the live-session and projector screens need about one check-in
// window. The session says which section it belongs to, and /my/sections has
// that section's name and size. The roster is asked for again every 5 seconds
// (shortcut: until the live WebSocket, task B5, lands).
export function useLiveSession(id: string) {
  const session = useApi<ClassSession>(`/class-sessions/${id}`);
  const sections = useApi<MySection[]>('/my/sections');
  const roster = useApi<Roster>(`/class-sessions/${id}/roster`, 5000);

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
