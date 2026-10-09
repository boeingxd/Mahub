import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fakeRoster } from '../fakeData';
import { sampleSession } from '../sampleSession';
import { BackIcon, Button, Card, ConfirmDialog, ProjectorIcon, SegmentedControl } from '../ui';
import { RosterTable } from './RosterPage';

type View = 'checkin' | 'roster';

// The live session, on the instructor's laptop (which is usually mirrored to
// the projector). "Check-in" shows only what the class may see: the QR and the
// count. "Roster" shows names, for the instructor's eyes.
export function SessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('checkin');
  const [confirming, setConfirming] = useState(false);
  const { section, startedAt, checkedIn } = sampleSession(id);

  function present() {
    // Real full screen needs a click to start it, so ask here, then show the
    // projector page. If the browser refuses, the page still works in a window.
    document.documentElement.requestFullscreen?.().catch(() => {});
    navigate(`/projector/${id}`);
  }

  function endSession() {
    // The real call (task P3) closes the window; then show the summary.
    setConfirming(false);
    navigate(`/summary/${id}`);
  }

  return (
    <>
      <Link to="/instructor" className="back-link">
        <BackIcon />
        My classes
      </Link>

      <header className={`session-head pass-${section.color}`}>
        <div>
          <h1 className="session-title">{section.name}</h1>
          <p className="session-sub">
            {section.course} · Section {section.sectionNo}
          </p>
          <p className="session-meta">
            <span className="live-dot" aria-hidden="true" />
            Check-in open · started {startedAt}
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

      {view === 'checkin' ? (
        <section className="session-board" aria-label="Check-in">
          <div className="qr-tile">
            {/* The rotating QR code goes here (tasks Y3 and B6). It sits on pure
                white with a margin around it, which phone cameras need to read it. */}
            <span className="qr-placeholder">QR code</span>
          </div>
          <div className="session-count">
            <p className="count" aria-live="polite">
              <span className="count-now">{checkedIn}</span>
              <span className="count-of"> / {section.enrolled}</span>
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
        <Card title="Students" footer="Sample roster: 5 of the class. Updates live once the WebSocket (task B5) lands.">
          <RosterTable rows={fakeRoster} live />
        </Card>
      )}

      <div className="session-end">
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          End session
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`End check-in for ${section.course}?`}
        message="Students can't check in after this. Anyone who hasn't checked in will be marked absent."
        confirmLabel="End session"
        onConfirm={endSession}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
