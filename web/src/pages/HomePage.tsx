import { Link } from 'react-router';
import { ButtonLink } from '../ui';

// The front door: everyone starts here and signs in with Google.
// After sign-in the API sends instructors to /instructor and students to
// /student (task Y1). Students who scanned a QR go back to /checkin instead.
export function HomePage() {
  return (
    <div className="center-screen">
      <div className="signin">
        {/* The app mark: two passes, one stacked behind the other. */}
        <svg className="app-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <rect className="app-mark-back" x="12" y="6" width="40" height="30" rx="8" />
          <rect className="app-mark-front" x="6" y="18" width="52" height="40" rx="10" />
          <path className="app-mark-check" d="m21 38 7 7 15-15" />
        </svg>
        <h1 className="signin-title">Mahub</h1>
        <p className="signin-lede">Class attendance for SIIT. Scan the code in class, and you're checked in.</p>

        {/* A real link, not a React Router link: the browser must leave our app
            and go to the API, which redirects to Google (task Y1). */}
        <ButtonLink href="/api/auth/login" className="button-block">
          Sign in with Google
        </ButtonLink>

        <p className="signin-note">
          Students: use your SIIT account (student number @g.siit.tu.ac.th). Instructors: use the Google account your
          admin registered.
        </p>
      </div>

      {/* Temporary, until sign-in works: a way into every screen with sample data. */}
      <Link to="/dev" className="dev-link">
        Preview screens with sample data
      </Link>
    </div>
  );
}
