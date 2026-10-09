import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary';

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
  children: ReactNode;
}

// A link that looks like a button. Used when clicking must leave the React app
// and load a real server URL, like /api/auth/login (which redirects to Google).
export function ButtonLink({ href, variant = 'primary', children }: ButtonLinkProps) {
  return (
    <a className={`button button-${variant}`} href={href}>
      {children}
    </a>
  );
}
