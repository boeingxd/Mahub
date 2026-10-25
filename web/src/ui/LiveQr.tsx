import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiGet, errorCode, errorText, type QrAnswer } from '../api';
import { Badge } from './Badge';

// The QR students scan. The server says what the QR is right now and how many
// seconds until it changes (expires_in); we draw it, wait that long, and ask
// again. An old QR stops working, so a screenshot of it is useless.
//
// If asking fails we keep showing the last QR with a "Connection degraded"
// badge instead of an error page: it stays valid for a few seconds anyway.
export function LiveQr({ sessionId }: { sessionId: string }) {
  const [picture, setPicture] = useState<string | null>(null); // the QR as an image
  const [problem, setProblem] = useState<string | null>(null); // an error code

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      let waitMs = 2000; // after a failure, try again soon
      try {
        const qr = await apiGet<QrAnswer>(`/class-sessions/${sessionId}/qr`);
        // The image is a data: URL, which the strict CSP allows (img-src data:).
        const image = await QRCode.toDataURL(qr.url, { margin: 0, width: 720, errorCorrectionLevel: 'M' });
        if (stopped) return;
        setPicture(image);
        setProblem(null);
        waitMs = qr.expires_in * 1000 + 250; // just after the next window starts
      } catch (e) {
        if (stopped) return;
        setProblem(errorCode(e));
        if (errorCode(e) === 'SESSION_CLOSED') return; // it's over: stop asking
      }
      timer = setTimeout(refresh, waitMs);
    }

    refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  if (problem === 'SESSION_CLOSED') return <span className="qr-placeholder">Check-in has ended</span>;
  if (!picture) {
    return (
      <span className="qr-placeholder" role={problem ? 'alert' : 'status'}>
        {problem ? (errorText[problem] ?? errorText.INTERNAL).title : 'Loading…'}
      </span>
    );
  }
  return (
    <>
      <img className="qr-image" src={picture} alt="QR code: scan it with your phone camera to check in" />
      {problem && (
        <span className="qr-degraded" role="status">
          <Badge tone="warning">Connection degraded</Badge>
        </span>
      )}
    </>
  );
}
