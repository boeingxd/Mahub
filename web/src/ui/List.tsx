import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronIcon } from './icons';

// A grouped list, like the sections in iOS Settings: rows inside one rounded
// panel, with an optional heading above and a note below.
export function List({ header, footer, children }: { header?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="list-group">
      {header && <h2 className="group-header">{header}</h2>}
      <ul className="list">{children}</ul>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}

interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode; // a second, smaller line under the title
  detail?: ReactNode; // right side: a value, a badge, a time
  leading?: ReactNode; // left side: e.g. a colour dot
  to?: string; // makes the whole row a link (with a chevron)
}

// One row. With `to`, the whole row is tappable and opens another screen.
export function ListRow({ title, subtitle, detail, leading, to }: ListRowProps) {
  const content = (
    <>
      {leading && <span className="list-leading">{leading}</span>}
      <span className="list-text">
        <span className="list-title">{title}</span>
        {subtitle && <span className="list-subtitle">{subtitle}</span>}
      </span>
      {detail !== undefined && <span className="list-detail">{detail}</span>}
      {to && <ChevronIcon className="list-chevron" />}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className="list-row list-row-link">
          {content}
        </Link>
      ) : (
        <div className="list-row">{content}</div>
      )}
    </li>
  );
}
