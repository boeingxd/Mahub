import { ButtonLink, Card } from '../ui';

// Shown when Google sign-in worked but the email isn't allowed in (ADR 0007).
export function NotRegisteredPage() {
  return (
    <Card title="This account isn't registered">
      <p>
        Students must sign in with their SIIT account. Instructors must be registered by an admin first.
      </p>
      <ButtonLink href="/api/auth/login" variant="secondary">
        Try another account
      </ButtonLink>
    </Card>
  );
}
