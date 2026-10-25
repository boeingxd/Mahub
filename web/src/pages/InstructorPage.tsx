import { useState } from 'react';
import { useApi, type Me, type MySection } from '../api';
import { passColor } from '../passColor';
import { ApiStatus, Badge, ButtonRoute, Pass } from '../ui';

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
  const me = useApi<Me>('/me');
  const sections = useApi<MySection[]>('/my/sections');

  // Wait for both answers; the first one that failed decides what the person sees.
  if (me.state.status !== 'done') return <ApiStatus state={me.state} retry={me.retry} />;
  if (sections.state.status !== 'done') return <ApiStatus state={sections.state} retry={sections.retry} />;

  return (
    <>
      <header className="page-head">
        <h1 className="large-title">
          {hello}, {me.state.data.fullName}
        </h1>
        <p className="page-lede">Choose a class to start check-in.</p>
      </header>

      {sections.state.data.length === 0 ? (
        <p className="empty">You don't teach any classes yet.</p>
      ) : (
        <div className="pass-grid">
          {sections.state.data.map((s) => {
            const live = s.open_session_id !== null;
            return (
              <Pass
                key={s.id}
                color={passColor(s.course_code)}
                code={s.course_code}
                corner={live ? <Badge tone="success">Live</Badge> : undefined}
                title={s.course_name}
                fields={[
                  { label: 'Section', value: s.section_no, mono: true },
                  { label: 'Students', value: s.enrolled, mono: true },
                  { label: 'Term', value: s.term, mono: true },
                ]}
              >
                {/* Opening a new window needs the room list (GET /api/rooms, not built yet). */}
                <ButtonRoute to={live ? `/session/${s.open_session_id}` : `/session/new-${s.id}`} className="button-on-pass">
                  {live ? 'Return to check-in' : 'Start check-in'}
                </ButtonRoute>
              </Pass>
            );
          })}
        </div>
      )}
    </>
  );
}
