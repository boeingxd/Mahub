import { Link } from 'react-router';
import { useApi, type MyClass } from '../api';
import { passColor } from '../passColor';
import { rateText, sessionsCount } from '../studentFormat';
import { ApiStatus, ChevronIcon, Pass } from '../ui';

// A student's home: their classes as a stack of passes (like Apple Wallet).
// Each shows the student's own attendance rate; tap one for its history.
export function StudentClassesPage() {
  const classes = useApi<MyClass[]>('/my/classes');

  return (
    <>
      <h1 className="large-title">My classes</h1>
      {classes.state.status !== 'done' ? (
        <ApiStatus state={classes.state} retry={classes.retry} />
      ) : classes.state.data.length === 0 ? (
        <p className="empty">You're not in any classes yet. Ask your instructor to enroll you.</p>
      ) : (
        <ul className="pass-stack">
          {classes.state.data.map((c) => (
            <li key={c.section_id}>
              <Link
                to={`/student/class/${c.section_id}`}
                className="pass-link"
                aria-label={`${c.course_code} ${c.course_name}, ${c.rate_pct === null ? 'no attendance rate yet' : `${c.rate_pct}% attendance`}`}
              >
                <Pass
                  color={passColor(c.course_code)}
                  code={c.course_code}
                  corner={<span className="pass-rate">{rateText(c.rate_pct)}</span>}
                  title={c.course_name}
                  subtitle={c.instructor_name ? `Section ${c.section_no} · ${c.instructor_name}` : `Section ${c.section_no}`}
                  headingLevel="h2"
                >
                  <span className="pass-more">
                    {c.sessions_held === 0 ? 'No sessions yet' : `${sessionsCount(c)} sessions`}
                    <ChevronIcon />
                  </span>
                </Pass>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
