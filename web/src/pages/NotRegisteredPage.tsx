import { AlertIcon, ButtonLink } from '../ui';

// Shown when Google sign-in worked but the email isn't allowed in (ADR 0007).
export function NotRegisteredPage() {
  return (
    <div className="center-screen">
      <div className="signin">
        <AlertIcon className="signin-icon signin-icon-danger" />
        <h1 className="signin-title">This account isn't registered</h1>
        <p className="signin-lede">
          Students: sign in with your SIIT account. Instructors: ask an admin to register the Google account you use.
        </p>
        <ButtonLink href="/api/auth/login" className="button-block">
          Use another account
        </ButtonLink>
      </div>
    </div>
  );
}
