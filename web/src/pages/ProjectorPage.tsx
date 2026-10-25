import { useNavigate, useParams } from 'react-router';
import { firstNotDone } from '../api';
import { passColor } from '../passColor';
import { useLiveSession } from '../useLiveSession';
import { ApiStatus, LiveQr } from '../ui';

// Full screen for the projector: only what the whole class may see, made big
// enough to read from the back row. Always dark, so it doesn't glare.
export function ProjectorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { session, sections, roster, section, retry } = useLiveSession(id);

  const notReady = firstNotDone(session.state, sections.state, roster.state);
  if (notReady) return <ApiStatus state={notReady} retry={retry} />;
  if (roster.state.status !== 'done') return null; // for TypeScript
  if (!section) return <ApiStatus state={{ status: 'error', code: 'NOT_FOUND' }} retry={retry} />;
  const { counts } = roster.state.data;

  function exit() {
    // Leave browser full screen (if we're in it), then go back to the session.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(`/session/${id}`);
  }

  return (
    <div className="projector">
      <header className={`projector-band pass-${passColor(section.course_code)}`}>
        <p className="projector-code">
          {section.course_code} · Section {section.section_no}
        </p>
        <p className="projector-name">{section.course_name}</p>
      </header>

      <div className="projector-main">
        <div className="qr-tile qr-tile-large">
          <LiveQr sessionId={id} />
        </div>
        <div className="projector-count">
          <p className="count count-board" aria-live="polite">
            <span className="count-now">{counts.present}</span>
            <span className="count-of"> / {counts.enrolled}</span>
          </p>
          <p className="count-label">checked in</p>
          <p className="projector-hint">Scan with your phone camera, then sign in with your SIIT account.</p>
        </div>
      </div>

      <footer className="projector-foot">
        <button type="button" className="projector-exit" onClick={exit}>
          Exit full screen
        </button>
      </footer>
    </div>
  );
}
