import { Link } from 'react-router';
import { Card } from '../ui';

export function NotFoundPage() {
  return (
    <Card title="Page not found">
      <Link to="/">Go home</Link>
    </Card>
  );
}
