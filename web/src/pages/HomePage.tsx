import { Link } from 'react-router';
import { Card } from '../ui';

export function HomePage() {
  return (
    <Card title="Mahub">
      <p>Secure class attendance: scan the QR, sign in, check in.</p>
      <p className="muted">
        This is the app skeleton. Every screen below is a placeholder that will be built out in task B6.
      </p>
      <Link to="/login">Go to sign in</Link>
    </Card>
  );
}
