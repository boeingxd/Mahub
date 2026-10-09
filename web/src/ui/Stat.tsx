import type { ReactNode } from 'react';

// One number with a label under it, e.g. "18 / Present".
export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: 'success' | 'danger' }) {
  return (
    <div className={tone ? `stat stat-${tone}` : 'stat'}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
