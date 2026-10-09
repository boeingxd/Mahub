import { fakeOverallRate, fakeRecentCheckins, fakeStudentClasses } from '../fakeData';
import { List, ListRow, Stat } from '../ui';

// The student's overall picture: one rate across every class, the rate per
// class, and their latest check-ins. Only ever their own data.
export function StudentOverviewPage() {
  return (
    <>
      <h1 className="large-title">Overview</h1>

      <div className="card overview-stat">
        <Stat value={`${fakeOverallRate}%`} label="Attendance across all classes" />
      </div>

      <List header="By class">
        {fakeStudentClasses.map((c) => (
          <ListRow
            key={c.id}
            to={`/student/class/${c.id}`}
            leading={<span className={`color-dot pass-${c.color}`} />}
            title={c.course}
            subtitle={c.name}
            detail={<span className="mono">{c.rate}%</span>}
          />
        ))}
      </List>

      <List header="Recent check-ins">
        {fakeRecentCheckins.map((r) => (
          <ListRow
            key={`${r.classId}-${r.date}`}
            title={r.course}
            subtitle={r.date}
            detail={<span className="mono">{r.time}</span>}
          />
        ))}
      </List>

      <p className="sample-note">Sample data until sign-in and the attendance API are ready.</p>
    </>
  );
}
