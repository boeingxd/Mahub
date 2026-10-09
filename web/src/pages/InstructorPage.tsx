import { Link } from 'react-router';
import { fakeSections, type FakeSection } from '../fakeData';
import { Button, Card, Table, type Column } from '../ui';

const columns: Column<FakeSection>[] = [
  { header: 'Course', cell: (s) => `${s.course} ${s.name}` },
  { header: 'Section', cell: (s) => s.sectionNo },
  { header: 'Enrolled', cell: (s) => s.enrolled },
  {
    header: '',
    // Disabled until the open/close endpoints exist (task P3).
    cell: () => (
      <Button disabled title="Arrives with task P3">
        Open check-in
      </Button>
    ),
  },
];

export function InstructorPage() {
  return (
    <>
      <Card title="My sections">
        <p className="muted">Fake data for now.</p>
        <Table columns={columns} rows={fakeSections} rowKey={(s) => s.id} />
      </Card>
      <p>
        Preview: <Link to="/projector/demo">projector screen</Link> · <Link to="/roster/demo">live roster</Link>
      </p>
    </>
  );
}
