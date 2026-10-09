import type { ReactNode } from 'react';
import type { PassColor } from '../fakeData';

export type { PassColor };

export interface PassField {
  label: string;
  value: ReactNode;
  mono?: boolean; // numbers and times: equal-width digits so they line up
}

interface PassProps {
  color: PassColor; // the class's own colour, like a pass in Apple Wallet
  code: string; // course code: top left, or in front of the subtitle when there's no corner
  corner?: ReactNode; // top right: a status badge, a check mark, a rate...
  title: ReactNode; // the big line (class name, or "Checked in")
  subtitle?: ReactNode;
  fields?: PassField[]; // label-over-value pairs under a divider
  children?: ReactNode; // e.g. a button at the bottom
  className?: string;
  headingLevel?: 'h1' | 'h2' | 'h3';
}

// A class pass: a rounded card in the class's colour. The same class always has
// the same colour on every screen (dashboard, session, the student's result),
// so people recognise their class at a glance. Colour never means status.
export function Pass({
  color,
  code,
  corner,
  title,
  subtitle,
  fields,
  children,
  className = '',
  headingLevel = 'h2',
}: PassProps) {
  const Heading = headingLevel;
  return (
    <article className={`pass pass-${color} ${className}`}>
      {/* With a corner (a badge, a rate, a check), the code and corner share a
          top row like a Wallet pass. Without one, a lone code above the title
          would just be a label, so it joins the subtitle line instead. */}
      {corner && (
        <header className="pass-top">
          <span className="pass-code">{code}</span>
          <span className="pass-corner">{corner}</span>
        </header>
      )}
      <Heading className="pass-title">{title}</Heading>
      {corner ? (
        subtitle && <p className="pass-subtitle">{subtitle}</p>
      ) : (
        <p className="pass-subtitle">
          <span className="pass-code">{code}</span>
          {subtitle && <> · {subtitle}</>}
        </p>
      )}
      {fields && fields.length > 0 && (
        <dl className="pass-fields">
          {fields.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className={f.mono ? 'mono' : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="pass-actions">{children}</div>}
    </article>
  );
}
