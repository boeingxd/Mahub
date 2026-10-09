import { Link } from 'react-router';
import { fakeSession } from '../fakeData';
import { BackIcon, List, ListRow } from '../ui';

// Temporary: every screen in one list, with sample data, so the team can look
// at them before sign-in works (task Y1). Not linked from the real app except
// a small link on the sign-in page. Delete once sign-in routes people by role.
export function DevPage() {
  return (
    <div className="dev-screen">
      <Link to="/" className="back-link">
        <BackIcon />
        Sign in
      </Link>
      <h1 className="large-title">Screen previews</h1>
      <p className="page-lede">Sample data. Real people reach these screens through sign-in and the QR code.</p>

      <List header="Instructor (laptop)">
        <ListRow to="/instructor" title="My classes" subtitle="Home after sign-in" />
        <ListRow to={`/session/${fakeSession.id}`} title="Live session" subtitle="QR + count, and the roster" />
        <ListRow to={`/projector/${fakeSession.id}`} title="Projector" subtitle="Full screen for the class" />
        <ListRow to={`/summary/${fakeSession.id}`} title="Session summary" subtitle="After End session" />
      </List>

      <List header="Student (phone)">
        <ListRow to="/checkin" title="Check in" subtitle="After scanning the QR" />
        <ListRow to="/checkin?preview=done" title="Checked in" subtitle="The finished pass" />
        <ListRow to="/student" title="My classes" subtitle="Home after sign-in" />
        <ListRow to="/student/overview" title="Overview" subtitle="Rates and recent check-ins" />
        <ListRow to="/student/class/s1" title="Class detail" subtitle="One class's sessions" />
      </List>

      <List header="Other">
        <ListRow to="/" title="Sign in" />
        <ListRow to="/not-registered" title="Not registered" subtitle="Signed in with an unknown account" />
        <ListRow to="/this-page-does-not-exist" title="Page not found" />
      </List>
    </div>
  );
}
