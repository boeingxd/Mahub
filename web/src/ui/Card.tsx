import type { ReactNode } from 'react';

// A rounded white panel on the grey background (like a group in iOS Settings),
// with an optional heading above it. variant="stub" is kept for older pages;
// it now looks the same as a normal card.
export function Card({
  title,
  footer,
  variant = 'ticket',
  children,
}: {
  title?: string;
  footer?: ReactNode;
  variant?: 'ticket' | 'stub';
  children: ReactNode;
}) {
  return (
    <section className={variant === 'stub' ? 'card-group card-group-stub' : 'card-group'}>
      {title && <h2 className="group-header">{title}</h2>}
      <div className="card">{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}
