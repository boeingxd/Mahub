import { Link, Outlet } from 'react-router';
import { fakeInstructor } from '../fakeData';

// The frame around the instructor's screens: a slim bar with the app name,
// who is signed in, and Sign out. There is no menu: instructors move through
// the app by its own buttons (Start check-in, End session, ...).
// <Outlet /> is where React Router draws the current page.
export function Layout() {
  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <Link to="/instructor" className="app-name">
            Mahub
          </Link>
          <div className="app-bar-user">
            {/* Sample name until login works (task Y1). */}
            <span className="app-bar-name">{fakeInstructor.name}</span>
            {/* A real link: signing out is handled by the API (task Y1). */}
            <a className="app-bar-link" href="/api/auth/logout">
              Sign out
            </a>
          </div>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
