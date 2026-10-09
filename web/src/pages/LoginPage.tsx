import { ButtonLink, Card } from '../ui';

export function LoginPage() {
  return (
    <Card title="Sign in">
      <p>Students: use your SIIT Google account (10-digit student number @g.siit.tu.ac.th).</p>
      <p>Instructors: use the Google account your admin registered.</p>
      {/* A real link, not a React Router link: the browser must leave our app
          and go to the API, which redirects to Google (task Y1). */}
      <ButtonLink href="/api/auth/login">Sign in with Google</ButtonLink>
    </Card>
  );
}
