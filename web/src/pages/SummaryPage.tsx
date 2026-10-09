import { Link, useParams } from 'react-router';
import { fakeRoster, fakeSessionSummary } from '../fakeData';
import { sampleSession } from '../sampleSession';
import { BackIcon, Button, Card, Stat } from '../ui';
import { RosterTable } from './RosterPage';

// After "End session": what happened, and the full roster. The numbers will
// come from the database's report view (task P4), not from the browser.
export function SummaryPage() {
  const { id } = useParams();
  const { section } = sampleSession(id);
  const s = fakeSessionSummary;

  return (
    <>
      <Link to="/instructor" className="back-link">
        <BackIcon />
        My classes
      </Link>

      <header className="page-head page-head-row">
        <div>
          <h1 className="large-title">Session summary</h1>
          <p className="page-lede">
            {section.course} {section.name} · Section {section.sectionNo} · {s.date},{' '}
            <span className="mono">
              {s.startedAt}–{s.endedAt}
            </span>
          </p>
        </div>
        <Button variant="secondary" disabled title="Arrives with task P4">
          Export CSV
        </Button>
      </header>

      <div className="stat-row">
        <Stat value={s.enrolled} label="Enrolled" />
        <Stat value={s.present} label="Present" tone="success" />
        <Stat value={s.excused} label="Excused" />
        <Stat value={s.absent} label="Absent" tone="danger" />
      </div>

      <Card title="Students" footer="Sample data until the report views (task P4) are ready.">
        <RosterTable rows={fakeRoster} />
      </Card>
    </>
  );
}
