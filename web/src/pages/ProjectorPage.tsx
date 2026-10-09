import { Link, useParams } from 'react-router';

// Full screen, no header: this is what the class sees on the projector.
export function ProjectorPage() {
  const { id } = useParams();
  return (
    <div className="projector">
      <h1>Scan to check in</h1>
      <div className="projector-qr">
        {/* The rotating QR code goes here (tasks Y3 and B6). */}
        QR code for session {id}
      </div>
      <div className="projector-count">0 checked in</div>
      <Link to="/instructor" className="muted">
        Back
      </Link>
    </div>
  );
}
