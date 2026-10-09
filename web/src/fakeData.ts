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

// The summary shown after the instructor ends a session.
export const fakeSessionSummary = {
  date: 'Fri 9 Oct',
  startedAt: '09:00',
  endedAt: '09:06',
  enrolled: 32,
  present: 18,
  excused: 1,
  absent: 13,
};

export type RosterStatus = 'present' | 'excused' | 'absent';

export interface FakeRosterRow {
  studentNo: string;
  name: string;
  status: RosterStatus;
  time?: string; // check-in time, 24 h
  manual?: boolean; // marked by the instructor by hand (attendance.method = 'manual')
}

export const fakeRoster: FakeRosterRow[] = [
  { studentNo: '6722780001', name: 'Student One', status: 'present', time: '09:01' },
  { studentNo: '6722780002', name: 'Student Two', status: 'present', time: '09:02' },
  { studentNo: '6722780003', name: 'Student Three', status: 'excused', manual: true },
  { studentNo: '6722780004', name: 'Student Four', status: 'absent' },
  { studentNo: '6722780005', name: 'Student Five', status: 'present', time: '09:03' },
];

// --- Student side ---

export const fakeStudent = { studentNo: '6722780001', name: 'Student One' };

export interface FakeStudentClass {
  id: string;
  course: string;
  name: string;
  sectionNo: number;
  instructor: string;
  color: PassColor;
  rate: number; // personal attendance rate, %
  attended: number;
  held: number;
}

export const fakeStudentClasses: FakeStudentClass[] = [
  { id: 's1', course: 'ITS332', name: 'Database Systems', sectionNo: 1, instructor: 'Somchai', color: 'teal', rate: 92, attended: 11, held: 12 },
  { id: 's2', course: 'ITS323', name: 'Computer Networks', sectionNo: 2, instructor: 'Kanya', color: 'indigo', rate: 75, attended: 6, held: 8 },
  { id: 's3', course: 'ITS351', name: 'Software Engineering', sectionNo: 1, instructor: 'Prasert', color: 'orange', rate: 100, attended: 4, held: 4 },
];

export const fakeOverallRate = 88; // across all classes (from a report view later)

export interface FakeHistoryRow {
  date: string;
  status: 'present' | 'absent';
  time: string | null; // 24 h; null when absent
}

export const fakeStudentHistory: Record<string, FakeHistoryRow[]> = {
  s1: [
    { date: 'Fri 9 Oct', status: 'present', time: '09:01' },
    { date: 'Tue 6 Oct', status: 'present', time: '09:03' },
    { date: 'Fri 2 Oct', status: 'absent', time: null },
    { date: 'Tue 29 Sep', status: 'present', time: '09:00' },
  ],
  s2: [
    { date: 'Thu 8 Oct', status: 'present', time: '13:02' },
    { date: 'Mon 5 Oct', status: 'absent', time: null },
    { date: 'Thu 1 Oct', status: 'present', time: '13:05' },
  ],
  s3: [
    { date: 'Wed 7 Oct', status: 'present', time: '10:31' },
    { date: 'Wed 30 Sep', status: 'present', time: '10:30' },
  ],
};

export const fakeRecentCheckins = [
  { classId: 's1', course: 'ITS332', name: 'Database Systems', date: 'Fri 9 Oct', time: '09:01' },
  { classId: 's2', course: 'ITS323', name: 'Computer Networks', date: 'Thu 8 Oct', time: '13:02' },
  { classId: 's3', course: 'ITS351', name: 'Software Engineering', date: 'Wed 7 Oct', time: '10:31' },
];
