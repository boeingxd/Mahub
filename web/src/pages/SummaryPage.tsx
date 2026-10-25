import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { apiPost, errorCode, firstNotDone } from '../api';
import { hhmm, toRosterRows, useLiveSession } from '../useLiveSession';
import { ApiStatus, BackIcon, ButtonLink, Card, ErrorBox, Stat } from '../ui';
import { RosterTable, type RosterRow } from './RosterPage';

// After "End session": what happened, and the full roster. The numbers come
// from the database's report view (GET /class-sessions/:id/roster), not from the browser.
export function SummaryPage() {
  const { id = '' } = useParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const { session, sections, roster, section, retry } = useLiveSession(id);

  const notReady = firstNotDone(session.state, sections.state, roster.state);
  if (notReady) return <ApiStatus state={notReady} retry={retry} />;
  if (session.state.status !== 'done' || roster.state.status !== 'done') return null; // for TypeScript
  if (!section) return <ApiStatus state={{ status: 'error', code: 'NOT_FOUND' }} retry={retry} />;
  // Still open: the live screen is the right place.
  const { opened_at, closed_at } = session.state.data;
  if (!closed_at) return <Navigate to={`/session/${id}`} replace />;

  const { counts, students } = roster.state.data;
  const date = new Date(opened_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  // The API lets the instructor fix a mark after the window has closed (a missed scan, an excuse).
  async function mark(row: RosterRow, status: 'present' | 'excused') {
    try {
      await apiPost(`/class-sessions/${id}/attendance`, { student_id: row.studentId, status });
      setActionError(null);
      roster.refresh();
    } catch (e) {
      setActionError(errorCode(e));
    }
  }

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
            {section.course_code} {section.course_name} · Section {section.section_no} · {date},{' '}
            <span className="mono">
              {hhmm(opened_at)}–{hhmm(closed_at)}
            </span>
          </p>
        </div>
        {/* A plain link: the browser sends the sign-in cookie and the API answers with a file download. */}
        <ButtonLink variant="secondary" href={`/api/sections/${section.id}/report?format=csv`}>
          Download class report (CSV)
        </ButtonLink>
      </header>

      <div className="stat-row">
        <Stat value={counts.enrolled} label="Enrolled" />
        <Stat value={counts.present} label="Present" tone="success" />
        <Stat value={counts.excused} label="Excused" />
        <Stat value={counts.absent} label="Absent" tone="danger" />
      </div>

      {actionError && <ErrorBox code={actionError} />}

      <Card title="Students" footer="Refreshes every few seconds.">
        <RosterTable rows={toRosterRows(students)} onMark={mark} />
      </Card>
    </>
  );
}
