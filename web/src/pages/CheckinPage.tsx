import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiPost, errorCode } from '../api';
import { fakeSections, fakeStudent } from '../fakeData';
import { AlertIcon, Button, ButtonRoute, CheckIcon, ErrorBox, LocationIcon, Pass } from '../ui';

type CheckinState =
  | { step: 'idle' }
  | { step: 'asking' } // waiting for the phone's location
  | { step: 'sending' } // location found, waiting for the server's answer
  | { step: 'done'; distance: number | null } // distance is null when it was already recorded
  | { step: 'locationError'; title: string; message: string } // the phone couldn't give a location
  | { step: 'apiError'; code: string }; // the server said no; errorText turns the code into words

interface CheckinAnswer {
  result: 'present';
  distance_m: number;
}

// The scan link (/c/...) can send the student here with an error already known.
const SCAN_ERRORS = ['QR_EXPIRED', 'SESSION_CLOSED'];

// The page a student lands on after scanning the QR (and signing in).
// One action: share location. The server then decides and records attendance.
// Built for a phone first; there's no tab bar here, students arrive from the QR.
export function CheckinPage() {
  const [params] = useSearchParams();
  // ?preview=done shows the finished "Checked in" pass with sample data, so the
  // team can see it without scanning a QR.
  const preview = params.get('preview') === 'done';
  // /checkin?error=QR_EXPIRED: show that straight away instead of asking for a location.
  const scanError = params.get('error');
  const [state, setState] = useState<CheckinState>(() =>
    scanError && SCAN_ERRORS.includes(scanError) ? { step: 'apiError', code: scanError } : { step: 'idle' },
  );
  const section = fakeSections[0]; // preview only

  // Ask the phone where it is (HTTPS only), then send it to the server.
  // The class and the student come from cookies, not from this request.
  function shareLocation() {
    if (!('geolocation' in navigator)) {
      setState({
        step: 'locationError',
        title: 'No location on this browser',
        message: 'Open this page in Safari or Chrome, or ask your instructor to mark you present.',
      });
      return;
    }
    setState({ step: 'asking' });
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setState({ step: 'sending' });
        try {
          const answer = await apiPost<CheckinAnswer>('/checkin/complete', {
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: Math.min(coords.accuracy, 5000), // the server rejects anything above 5000
          });
          setState({ step: 'done', distance: answer.distance_m });
        } catch (e) {
          const code = errorCode(e);
          // Already checked in is good news, not an error.
          setState(code === 'ALREADY_PRESENT' ? { step: 'done', distance: null } : { step: 'apiError', code });
        }
      },
      (err) =>
        setState(
          err.code === err.PERMISSION_DENIED
            ? {
                step: 'locationError',
                title: 'Location is turned off for Mahub',
                message: 'Allow location for this site in your browser settings, then try again.',
              }
            : {
                step: 'locationError',
                title: "Couldn't find your location",
                message: 'Move nearer a window or turn on Wi-Fi, then try again.',
              },
        ),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  if (preview) {
    return (
      <div className="phone-screen">
        <h1 className="large-title">Done</h1>
        <Pass
          color={section.color}
          code={section.course}
          corner={<CheckIcon className="pass-check" />}
          title="Checked in"
          subtitle={`${section.name} · Section ${section.sectionNo}`}
          headingLevel="h2"
          className="pass-enter"
          fields={[
            { label: 'Student', value: fakeStudent.studentNo, mono: true },
            { label: 'Time', value: '09:01', mono: true },
            { label: 'Distance', value: '12 m', mono: true },
          ]}
        />
        <ButtonRoute to={`/student/class/${section.id}`} variant="secondary" className="button-block">
          See my attendance
        </ButtonRoute>
        <p className="footnote">Preview with sample data. You can also just close this page.</p>
      </div>
    );
  }

  const busy = state.step === 'asking' || state.step === 'sending';
  // The scan is used up after most errors, so the student has to scan the QR again.
  // OUT_OF_RANGE and LOCATION_IMPRECISE keep it for 90 s, so a retry with better GPS is allowed.
  const canRetry =
    state.step === 'locationError' ||
    (state.step === 'apiError' && (state.code === 'OUT_OF_RANGE' || state.code === 'LOCATION_IMPRECISE'));
  const showButton = state.step === 'idle' || busy || canRetry;
  const buttonText =
    state.step === 'asking'
      ? 'Finding you…'
      : state.step === 'sending'
        ? 'Checking in…'
        : canRetry
          ? 'Try again'
          : 'Share my location';

  return (
    <div className="phone-screen">
      <h1 className="large-title">Check in</h1>

      {showButton && (
        <>
          <p className="footnote">
            We check that you're in the classroom. Your exact location is never stored, only how far you are from the
            room.
          </p>
          <Button className="button-block" onClick={shareLocation} disabled={busy} aria-busy={busy}>
            <LocationIcon />
            {buttonText}
          </Button>
        </>
      )}

      {state.step === 'locationError' && (
        <div className="inline-alert" role="alert">
          <AlertIcon className="inline-alert-icon" />
          <div>
            <p className="inline-alert-title">{state.title}</p>
            <p className="inline-alert-text">{state.message}</p>
          </div>
        </div>
      )}

      {state.step === 'apiError' && <ErrorBox code={state.code} />}

      {state.step === 'done' && (
        <section className="result" aria-live="polite" aria-label="Result">
          <div className="result-card pass-enter">
            <CheckIcon className="result-icon" />
            <div>
              <p className="result-title">{state.distance === null ? "You're already checked in" : "You're checked in"}</p>
              {state.distance !== null && (
                <p className="result-text">
                  You're <span className="mono">{Math.round(state.distance)} m</span> from the room.
                </p>
              )}
            </div>
          </div>
          <p className="footnote">You can close this page.</p>
        </section>
      )}
    </div>
  );
}
