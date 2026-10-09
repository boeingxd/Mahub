import { Navigate } from 'react-router';

// Sign-in now lives on the front page (/). Old links to /login still work.
export function LoginPage() {
  return <Navigate to="/" replace />;
}
