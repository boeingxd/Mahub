import { NavLink, Outlet } from 'react-router';

// The frame around every normal page: a header with navigation, then the page.
// <Outlet /> is where React Router draws the current page.
export function Layout() {
  return (
    <>
      <header className="layout-header">
        <div className="layout-header-inner">
          <NavLink to="/" className="layout-brand">
            Mahub
          </NavLink>
          {/* Temporary: links to every screen while we build them. Once login
              works (task Y1), each person only sees the screens for their role. */}
          <nav className="layout-nav" aria-label="Screens">
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/instructor">Instructor</NavLink>
            <NavLink to="/projector/demo">Projector</NavLink>
            <NavLink to="/checkin">Student check-in</NavLink>
            <NavLink to="/roster/demo">Roster</NavLink>
          </nav>
        </div>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
    </>
  );
}
