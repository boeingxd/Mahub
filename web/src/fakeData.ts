// Made-up data so the screens have something to show before the real API
// endpoints exist. Each screen switches to the real endpoint from docs/API.md
// as it lands (task B6), and then this file is deleted.
//
// Rates and counts here are fixed numbers on purpose: the real ones will come
// from the database's report views, never calculated in the browser.

// Each class gets one pass colour (like Apple Wallet). The colour names match
// the --pass-* tokens in src/ui/tokens.css.
export type PassColor = 'teal' | 'indigo' | 'orange' | 'pink' | 'slate' | 'purple'; // no green: green means "present"

export const fakeInstructor = { name: 'Somchai' };

export interface FakeSection {
  id: string;
  course: string;
  name: string;
  sectionNo: number;
  enrolled: number;
  color: PassColor;
  room: string | null; // null until rooms exist (task P2); shown as "—"
}

export const fakeSections: FakeSection[] = [
  { id: 's1', course: 'ITS332', name: 'Database Systems', sectionNo: 1, enrolled: 32, color: 'teal', room: null },
  { id: 's2', course: 'ITS323', name: 'Computer Networks', sectionNo: 2, enrolled: 28, color: 'indigo', room: null },
];

// The check-in window that's open right now (one per section at most).
export const fakeSession = {
  id: 'demo',
  sectionId: 's1',
  startedAt: '09:00',
  checkedIn: 18,
};

export type RosterStatus = 'present' | 'excused' | 'absent';

export interface FakeRosterRow {
  studentNo: string;
  name: string;
  status: RosterStatus;
  time?: string; // check-in time, 24 h
  manual?: boolean; // marked by the instructor by hand (attendance.method = 'manual')
}

// --- Student side ---

export const fakeStudent = { studentNo: '6722780001', name: 'Student One' };
