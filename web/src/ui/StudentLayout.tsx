import { NavLink, Outlet } from 'react-router';
import { ClassesIcon, OverviewIcon } from './icons';

// The frame around a student's screens on their phone: the page, plus a tab bar
// at the bottom where a thumb can reach it (like most iPhone apps).
// Checking in is not a tab: students get there by scanning the QR in class.
export function StudentLayout() {
  return (
    <div className="student-shell">
      <main className="student-main">
        <Outlet />
      </main>
      <nav className="tab-bar" aria-label="Student">
        {/* "end" means: only highlight My classes on /student itself, not on /student/overview. */}
        <NavLink to="/student" end className="tab-bar-item">
          <ClassesIcon />
          <span>My classes</span>
        </NavLink>
        <NavLink to="/student/overview" className="tab-bar-item">
          <OverviewIcon />
          <span>Overview</span>
        </NavLink>
      </nav>
    </div>
  );
}
