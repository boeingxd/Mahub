import { useApi, type MyOverview } from '../api';
import { passColor } from '../passColor';
import { dayLabel, rateText, timeLabel } from '../studentFormat';
import { ApiStatus, List, ListRow, Stat } from '../ui';

// The student's overall picture: one rate across every class, the rate per
// class, and their latest check-ins. Only ever their own data.
export function StudentOverviewPage() {
  const overview = useApi<MyOverview>('/my/overview');

  if (overview.state.status !== 'done') {
    return (
      <>
        <h1 className="large-title">Overview</h1>
        <ApiStatus state={overview.state} retry={overview.retry} />
      </>
    );
  }
  const { overall, classes, recent_checkins } = overview.state.data;

  return (
    <>
      <h1 className="large-title">Overview</h1>

      <div className="card overview-stat">
        <Stat value={rateText(overall.rate_pct)} label="Attendance across all classes" />
      </div>

      <List header="By class">
        {classes.length === 0 ? (
          <ListRow title="You're not in any classes yet." />
        ) : (
          classes.map((c) => (
            <ListRow
              key={c.section_id}
              to={`/student/class/${c.section_id}`}
              leading={<span className={`color-dot pass-${passColor(c.course_code)}`} />}
              title={c.course_code}
              subtitle={c.course_name}
              detail={<span className="mono">{rateText(c.rate_pct)}</span>}
            />
          ))
        )}
      </List>

      <List header="Recent check-ins">
        {recent_checkins.length === 0 ? (
          <ListRow title="No check-ins yet." />
        ) : (
          recent_checkins.map((r) => (
            <ListRow
              key={r.class_session_id}
              title={r.course_code}
              subtitle={r.method === 'manual' ? `${dayLabel(r.recorded_at)} · Marked by your instructor` : dayLabel(r.recorded_at)}
              detail={<span className="mono">{timeLabel(r.recorded_at)}</span>}
            />
          ))
        )}
      </List>
    </>
  );
}
