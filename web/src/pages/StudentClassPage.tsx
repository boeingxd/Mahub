import { Link, useParams } from 'react-router';
import { fakeStudentClasses, fakeStudentHistory } from '../fakeData';
import { BackIcon, Badge, List, ListRow, Pass } from '../ui';

// One class, from the student's side: their rate and every session so far.
export function StudentClassPage() {
  const { id } = useParams();
  const c = fakeStudentClasses.find((x) => x.id === id);

  if (!c) {
    return (
      <>
        <Link to="/student" className="back-link">
          <BackIcon />
          My classes
        </Link>
        <p className="empty">This class isn't in your list.</p>
      </>
    );
  }

  const history = fakeStudentHistory[c.id] ?? [];

  return (
    <>
      <Link to="/student" className="back-link">
        <BackIcon />
        My classes
      </Link>

      <Pass
        color={c.color}
        code={c.course}
        title={c.name}
        subtitle={`Section ${c.sectionNo} · ${c.instructor}`}
        headingLevel="h1"
        fields={[
          { label: 'Attendance', value: `${c.rate}%`, mono: true },
          { label: 'Sessions', value: `${c.attended} of ${c.held}`, mono: true },
        ]}
      />

      <List header="Sessions" footer="Sample data. Times are 24-hour.">
        {history.length === 0 ? (
          <ListRow title="No sessions held yet for this class." />
        ) : (
          history.map((h) => (
            <ListRow
              key={h.date}
              title={h.date}
              subtitle={h.time ? <span className="mono">{h.time}</span> : undefined}
              detail={
                h.status === 'present' ? <Badge tone="success">Present</Badge> : <Badge tone="danger">Absent</Badge>
              }
            />
          ))
        )}
      </List>
    </>
  );
}
