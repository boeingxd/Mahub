import { Link, useParams } from 'react-router';
import { useApi, type MyClassSessions, type MySession } from '../api';
import { passColor } from '../passColor';
import { dayLabel, rateText, sessionsCount, timeLabel } from '../studentFormat';
import { ApiStatus, BackIcon, Badge, List, ListRow, Pass } from '../ui';

// What a window says about the student: present, excused, absent, or, for a
// window that is still open and has no check-in yet, "Open now" (not "Absent").
function SessionBadge({ s }: { s: MySession }) {
  if (s.status === 'present') return <Badge tone="success">Present</Badge>;
  if (s.status === 'excused') return <Badge tone="neutral">Excused</Badge>;
  return s.is_open ? <Badge tone="warning">Open now</Badge> : <Badge tone="danger">Absent</Badge>;
}

const BackLink = () => (
  <Link to="/student" className="back-link">
    <BackIcon />
    My classes
  </Link>
);

// One class, from the student's side: their rate and every session so far.
// The route id is the section id. `key` makes the screen start fresh when it changes.
export function StudentClassPage() {
  const { id = '' } = useParams();
  return <ClassDetail key={id} sectionId={id} />;
}

function ClassDetail({ sectionId }: { sectionId: string }) {
  const detail = useApi<MyClassSessions>(`/my/classes/${sectionId}/sessions`);

  if (detail.state.status !== 'done') {
    return (
      <>
        <BackLink />
        {/* The API answers 403 for a class you're not in, and for an id that doesn't exist. */}
        {detail.state.status === 'error' && detail.state.code === 'FORBIDDEN' ? (
          <p className="empty">This class isn't in your list.</p>
        ) : (
          <ApiStatus state={detail.state} retry={detail.retry} />
        )}
      </>
    );
  }
  const { class: c, sessions } = detail.state.data;

  return (
    <>
      <BackLink />

      <Pass
        color={passColor(c.course_code)}
        code={c.course_code}
        title={c.course_name}
        subtitle={c.instructor_name ? `Section ${c.section_no} · ${c.instructor_name}` : `Section ${c.section_no}`}
        headingLevel="h1"
        fields={[
          { label: 'Attendance', value: rateText(c.rate_pct), mono: true },
          { label: 'Sessions', value: sessionsCount(c), mono: true },
        ]}
      />

      <List header="Sessions" footer="Times are 24-hour.">
        {sessions.length === 0 ? (
          <ListRow title="No sessions held yet for this class." />
        ) : (
          sessions.map((s) => (
            <ListRow
              key={s.class_session_id}
              title={dayLabel(s.opened_at)}
              subtitle={
                s.status === 'present' && s.recorded_at ? (
                  <span className="mono">
                    {timeLabel(s.recorded_at)}
                    {s.method === 'manual' ? ' · Marked by your instructor' : ''}
                  </span>
                ) : s.status === 'excused' ? (
                  'Marked by your instructor'
                ) : undefined
              }
              detail={<SessionBadge s={s} />}
            />
          ))
        )}
      </List>
    </>
  );
}
