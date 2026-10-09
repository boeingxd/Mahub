import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

// primary: filled tint, the one main action on a screen.
// secondary: tinted, for the other actions.
// destructive: red text, for things like "End session".
type Variant = 'primary' | 'secondary' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

// A normal button, e.g. "Open check-in".
export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}

// A link that looks like a button. Used when clicking must leave the React app
// and load a real server URL, like /api/auth/login (which redirects to Google).
export function ButtonLink({ href, variant = 'primary', className = '', children }: ButtonLinkProps) {
  return (
    <a className={`button button-${variant} ${className}`} href={href}>
      {children}
    </a>
  );
}

interface ButtonRouteProps {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}

// A button that moves to another screen inside the app (no page reload).
export function ButtonRoute({ to, variant = 'primary', className = '', children }: ButtonRouteProps) {
  return (
    <Link className={`button button-${variant} ${className}`} to={to}>
      {children}
    </Link>
  );
}
