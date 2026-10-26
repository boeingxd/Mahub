import { useState } from 'react';
import { useNavigate } from 'react-router';
import { apiPost, errorCode, errorText, useApi, type ClassSession, type Me, type MySection, type Room } from '../api';
import { passColor } from '../passColor';
import { ActionSheet, ApiStatus, Badge, Button, ButtonRoute, ErrorBox, Pass, type SheetAction } from '../ui';

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
  // The rooms to choose from. Not part of the wait below: the dashboard is
  // useful even if this list fails, and the picker says so itself.
  const rooms = useApi<Room[]>('/rooms');
  // The section whose "Which room?" picker is open, if any.
  const [picking, setPicking] = useState<MySection | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Open a check-in window for `section` in `room`, then go to its live screen.
  // The server copies the room's location into the window and says who opened it.
  async function openCheckin(section: MySection, room: Room) {
    setPicking(null);
    setOpenError(null);
    try {
      const opened = await apiPost<ClassSession>(`/sections/${section.id}/class-sessions`, { room_id: room.id });
      navigate(`/session/${opened.id}`);
    } catch (e) {
      setOpenError(errorCode(e));
      // Someone already opened this class (maybe on another laptop): reload the
      // list so its card shows "Live" and "Return to check-in".
      if (errorCode(e) === 'SESSION_ALREADY_OPEN') sections.refresh();
    }
  }

  // Wait for both answers; the first one that failed decides what the person sees.
  if (me.state.status !== 'done') return <ApiStatus state={me.state} retry={me.retry} />;
  if (sections.state.status !== 'done') return <ApiStatus state={sections.state} retry={sections.retry} />;

  // What the picker offers: one button per room. Choosing one opens the window.
  const roomActions: SheetAction[] =
    rooms.state.status === 'done' && picking
      ? rooms.state.data.map((r) => ({ label: r.name, onSelect: () => openCheckin(picking, r) }))
      : [];
  const roomsMessage =
    rooms.state.status === 'loading'
      ? 'Loading rooms…'
      : rooms.state.status === 'error'
        ? (errorText[rooms.state.code] ?? errorText.INTERNAL).message
        : rooms.state.data.length === 0
          ? 'There are no rooms yet.'
          : undefined;

  return (
    <>
      <header className="page-head">
        <h1 className="large-title">
          {hello}, {me.state.data.fullName}
        </h1>
        <p className="page-lede">Choose a class to start check-in.</p>
      </header>

      {openError && (
        <ErrorBox code={openError}>
          {openError === 'UNAUTHENTICATED' && (
            <ButtonRoute to="/" className="api-status-action">
              Sign in
            </ButtonRoute>
          )}
        </ErrorBox>
      )}

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
                {live ? (
                  <ButtonRoute to={`/session/${s.open_session_id}`} className="button-on-pass">
                    Return to check-in
                  </ButtonRoute>
                ) : (
                  <Button onClick={() => setPicking(s)} className="button-on-pass">
                    Start check-in
                  </Button>
                )}
              </Pass>
            );
          })}
        </div>
      )}

      <ActionSheet
        open={picking !== null}
        title={picking ? `${picking.course_code} · Which room?` : ''}
        message={roomsMessage}
        actions={roomActions}
        onCancel={() => setPicking(null)}
      />
    </>
  );
}
