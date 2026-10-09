// Made-up data so the screens have something to show before the real API
// endpoints exist. Each screen switches to the real endpoint from docs/API.md
// as it lands (task B6), and then this file is deleted.

export interface FakeSection {
  id: string;
  course: string;
  name: string;
  sectionNo: number;
  enrolled: number;
}

export const fakeSections: FakeSection[] = [
  { id: 's1', course: 'ITS332', name: 'Database Systems', sectionNo: 1, enrolled: 32 },
  { id: 's2', course: 'ITS323', name: 'Computer Networks', sectionNo: 2, enrolled: 28 },
];

export type RosterStatus = 'present' | 'excused' | 'absent';

export interface FakeRosterRow {
  studentNo: string;
  name: string;
  status: RosterStatus;
  flagged: boolean;
}

export const fakeRoster: FakeRosterRow[] = [
  { studentNo: '6722780001', name: 'Student One', status: 'present', flagged: false },
  { studentNo: '6722780002', name: 'Student Two', status: 'present', flagged: true },
  { studentNo: '6722780003', name: 'Student Three', status: 'excused', flagged: false },
  { studentNo: '6722780004', name: 'Student Four', status: 'absent', flagged: false },
];
