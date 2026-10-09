import { useState } from 'react';
import { fakeInstructor, fakeSections, fakeSession } from '../fakeData';
import { Badge, ButtonRoute, Pass } from '../ui';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// The instructor's home after sign-in: one pass per section they teach.
// The only thing to do here is start (or go back to) a check-in.
export function InstructorPage() {
  // Worked out once when the page opens.
  const [hello] = useState(() => greeting(new Date().getHours()));

  return (
    <>
      <header className="page-head">
        <h1 className="large-title">
          {hello}, {fakeInstructor.name}
        </h1>
        <p className="page-lede">Choose a class to start check-in.</p>
      </header>

      <div className="pass-grid">
        {fakeSections.map((s) => {
          // Sample data: one section already has an open check-in window.
          const live = fakeSession.sectionId === s.id;
          return (
            <Pass
              key={s.id}
              color={s.color}
              code={s.course}
              corner={live ? <Badge tone="success">Live</Badge> : undefined}
              title={s.name}
              fields={[
                { label: 'Section', value: s.sectionNo, mono: true },
                { label: 'Students', value: s.enrolled, mono: true },
                { label: 'Room', value: s.room ?? '—' },
              ]}
            >
              {/* Opening a real window arrives with the class-session API (task P3). */}
              <ButtonRoute to={`/session/${live ? fakeSession.id : `new-${s.id}`}`} className="button-on-pass">
                {live ? 'Return to check-in' : 'Start check-in'}
              </ButtonRoute>
            </Pass>
          );
        })}
      </div>

      <p className="sample-note">Sample data until sign-in and the class-session API are ready.</p>
    </>
  );
}
