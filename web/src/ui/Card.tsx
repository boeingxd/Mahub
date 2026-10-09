import type { ReactNode } from 'react';

// A white box that groups related content, with an optional heading.
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
