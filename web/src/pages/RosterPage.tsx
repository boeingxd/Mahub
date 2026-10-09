import { fakeRoster, type FakeRosterRow, type RosterStatus } from '../fakeData';
import { Badge, Card, Table, type BadgeTone, type Column } from '../ui';

const statusTone: Record<RosterStatus, BadgeTone> = {
  present: 'success',
  excused: 'neutral',
  absent: 'danger',
};

const columns: Column<FakeRosterRow>[] = [
  { header: 'Student no.', cell: (r) => r.studentNo },
  { header: 'Name', cell: (r) => r.name },
  { header: 'Status', cell: (r) => <Badge tone={statusTone[r.status]}>{r.status}</Badge> },
  { header: 'Flags', cell: (r) => (r.flagged ? <Badge tone="warning">check</Badge> : '') },
];

export function RosterPage() {
  const present = fakeRoster.filter((r) => r.status === 'present').length;
  return (
    <Card title="Live roster">
      <p className="muted">
        Fake data. {present} of {fakeRoster.length} present. Updates live once task B5 lands.
      </p>
      <Table columns={columns} rows={fakeRoster} rowKey={(r) => r.studentNo} />
    </Card>
  );
}
