import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { apiPost, errorCode, firstNotDone } from '../api';
import { passColor } from '../passColor';
import { toRosterRows, useLiveSession, hhmm } from '../useLiveSession';
import {
  ApiStatus,
  BackIcon,
  Button,
  Card,
  ConfirmDialog,
  ErrorBox,
  LiveQr,
  ProjectorIcon,
  SegmentedControl,
} from '../ui';
import { RosterTable, type RosterRow } from './RosterPage';

type View = 'checkin' | 'roster';

export function SessionPage() {
  const { id = '' } = useParams();
  return <LiveSession id={id} />;
}

// The live session, on the instructor's laptop (which is usually mirrored to
// the projector). "Check-in" shows only what the class may see: the QR and the
// count. "Roster" shows names, for the instructor's eyes.
function LiveSession({ id }: { id: string }) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('checkin');
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { session, sections, roster, section, retry } = useLiveSession(id);

  const notReady = firstNotDone(session.state, sections.state, roster.state);
  if (notReady) return <ApiStatus state={notReady} retry={retry} />;
  if (session.state.status !== 'done' || roster.state.status !== 'done') return null; // for TypeScript
  if (!section) return <ApiStatus state={{ status: 'error', code: 'NOT_FOUND' }} retry={retry} />;
  // A closed window has nothing live left to show.
  if (session.state.data.closed_at) return <Navigate to={`/summary/${id}`} replace />;

  const { counts, students } = roster.state.data;

  function present() {
    // Real full screen needs a click to start it, so ask here, then show the
    // projector page. If the browser refuses, the page still works in a window.
    document.documentElement.requestFullscreen?.().catch(() => {});
    navigate(`/projector/${id}`);
  }

  async function endSession() {
    setConfirming(false);
    try {
      await apiPost(`/class-sessions/${id}/close`);
      navigate(`/summary/${id}`);
    } catch (e) {
      // Already closed (maybe on another screen): the summary is the right place anyway.
      if (errorCode(e) === 'SESSION_CLOSED') navigate(`/summary/${id}`);
      else setActionError(errorCode(e));
    }
  }

  async function mark(row: RosterRow, status: 'present' | 'excused') {
    try {
      await apiPost(`/class-sessions/${id}/attendance`, { student_id: row.studentId, status });
      setActionError(null);
      roster.refresh();
    } catch (e) {
      setActionError(errorCode(e));
    }
  }

  return (
    <>
      <Link to="/instructor" className="back-link">
        <BackIcon />
        My classes
      </Link>

      <header className={`session-head pass-${passColor(section.course_code)}`}>
        <div>
          <h1 className="session-title">{section.course_name}</h1>
          <p className="session-sub">
            {section.course_code} · Section {section.section_no}
          </p>
          <p className="session-meta">
            <span className="live-dot" aria-hidden="true" />
            Check-in open · started {hhmm(session.state.data.opened_at)}
          </p>
        </div>
        <SegmentedControl
          label="Session view"
          value={view}
          onChange={setView}
          options={[
            { value: 'checkin', label: 'Check-in' },
            { value: 'roster', label: 'Roster' },
          ]}
        />
      </header>

      {actionError && <ErrorBox code={actionError} />}

      {view === 'checkin' ? (
        <section className="session-board" aria-label="Check-in">
          <div className="qr-tile">
            {/* It sits on pure white with a margin around it, which phone cameras need to read it. */}
            <LiveQr sessionId={id} />
          </div>
          <div className="session-count">
            <p className="count" aria-live="polite">
              <span className="count-now">{counts.present}</span>
              <span className="count-of"> / {counts.enrolled}</span>
            </p>
            <p className="count-label">checked in</p>
            <p className="session-hint">Scan with your phone camera, then sign in with your SIIT account.</p>
            <Button variant="secondary" onClick={present}>
              <ProjectorIcon />
              Present full screen
            </Button>
          </div>
        </section>
      ) : (
        <Card title="Students" footer="Updates live as students check in.">
          <RosterTable rows={toRosterRows(students)} live onMark={mark} />
        </Card>
      )}

      <div className="session-end">
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          End session
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`End check-in for ${section.course_code}?`}
        message="Students can't check in after this. Anyone who hasn't checked in will be marked absent."
        confirmLabel="End session"
        onConfirm={endSession}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
