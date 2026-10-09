import { ButtonRoute } from '../ui';

export function NotFoundPage() {
  return (
    <div className="center-screen">
      <div className="signin">
        <h1 className="signin-title">Page not found</h1>
        <p className="signin-lede">There's nothing at this address. If you scanned a QR code, scan the one on screen again.</p>
        <ButtonRoute to="/" variant="secondary" className="button-block">
          Go to sign in
        </ButtonRoute>
      </div>
    </div>
  );
}
