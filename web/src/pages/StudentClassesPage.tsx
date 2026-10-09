import { Link } from 'react-router';
import { fakeStudentClasses } from '../fakeData';
import { ChevronIcon, Pass } from '../ui';

// A student's home: their classes as a stack of passes (like Apple Wallet).
// Each shows the student's own attendance rate; tap one for its history.
export function StudentClassesPage() {
  return (
    <>
      <h1 className="large-title">My classes</h1>
      {fakeStudentClasses.length === 0 ? (
        <p className="empty">You're not in any classes yet. Ask your instructor to enroll you.</p>
      ) : (
        <ul className="pass-stack">
          {fakeStudentClasses.map((c) => (
            <li key={c.id}>
              <Link to={`/student/class/${c.id}`} className="pass-link" aria-label={`${c.course} ${c.name}, ${c.rate}% attendance`}>
                <Pass
                  color={c.color}
                  code={c.course}
                  corner={<span className="pass-rate">{c.rate}%</span>}
                  title={c.name}
                  subtitle={`Section ${c.sectionNo} · ${c.instructor}`}
                  headingLevel="h2"
                >
                  <span className="pass-more">
                    {c.attended} of {c.held} sessions
                    <ChevronIcon />
                  </span>
                </Pass>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="sample-note">Sample data until sign-in and the attendance API are ready.</p>
    </>
  );
}
