import { useNavigate, useParams } from 'react-router';
import { sampleSession } from '../sampleSession';

// Full screen for the projector: only what the whole class may see, made big
// enough to read from the back row. Always dark, so it doesn't glare.
export function ProjectorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { section, checkedIn } = sampleSession(id);

  function exit() {
    // Leave browser full screen (if we're in it), then go back to the session.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(`/session/${id}`);
  }

  return (
    <div className="projector">
      <header className={`projector-band pass-${section.color}`}>
        <p className="projector-code">
          {section.course} · Section {section.sectionNo}
        </p>
        <p className="projector-name">{section.name}</p>
      </header>

      <div className="projector-main">
        <div className="qr-tile qr-tile-large">
          {/* The rotating QR code goes here (tasks Y3 and B6). */}
          <span className="qr-placeholder">QR code</span>
        </div>
        <div className="projector-count">
          <p className="count count-board" aria-live="polite">
            <span className="count-now">{checkedIn}</span>
            <span className="count-of"> / {section.enrolled}</span>
          </p>
          <p className="count-label">checked in</p>
          <p className="projector-hint">Scan with your phone camera, then sign in with your SIIT account.</p>
        </div>
      </div>

      <footer className="projector-foot">
        <button type="button" className="projector-exit" onClick={exit}>
          Exit full screen
        </button>
        <span>Sample data</span>
      </footer>
    </div>
  );
}
