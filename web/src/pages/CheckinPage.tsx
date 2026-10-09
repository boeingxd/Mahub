import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { fakeSections, fakeStudent } from '../fakeData';
import { AlertIcon, Button, ButtonRoute, CheckIcon, LocationIcon, Pass } from '../ui';

type LocationState =
  | { step: 'idle' }
  | { step: 'asking' }
  | { step: 'located'; accuracy: number; at: string }
  | { step: 'error'; title: string; message: string };

function timeNow(ms: number) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // 24 h, e.g. 09:02
}

// The page a student lands on after scanning the QR (and signing in).
// One action: share location. Then their class pass slides up: done.
// Built for a phone first; there's no tab bar here, students arrive from the QR.
export function CheckinPage() {
  const [state, setState] = useState<LocationState>({ step: 'idle' });
  const [params] = useSearchParams();
  // ?preview=done shows the finished "Checked in" pass with sample data, so the
  // team can see it before the check-in API (task Y4) exists.
  const preview = params.get('preview') === 'done';
  // Sample class until the scan link carries the real session (task B6).
  const section = fakeSections[0];
  const [today] = useState(() =>
    new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
  );

  // Temporary test: does this browser let us ask for location? Phones only
  // allow it over HTTPS (task B4 tests it on a real phone). Nothing is sent
  // anywhere yet; the real check-in call arrives with task B6.
  function shareLocation() {
    if (!('geolocation' in navigator)) {
      setState({
        step: 'error',
        title: 'No location on this browser',
        message: 'Open this page in Safari or Chrome, or ask your instructor to mark you present.',
      });
      return;
    }
    setState({ step: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({ step: 'located', accuracy: Math.round(pos.coords.accuracy), at: timeNow(pos.timestamp) }),
      (err) =>
        setState(
          err.code === err.PERMISSION_DENIED
            ? {
                step: 'error',
                title: 'Location is turned off for Mahub',
                message: 'Allow location for this site in your browser settings, then try again.',
              }
            : {
                step: 'error',
                title: "Couldn't find your location",
                message: 'Move nearer a window or turn on Wi-Fi, then try again.',
              },
        ),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const asking = state.step === 'asking';

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

  return (
    <div className="phone-screen">
      <h1 className="large-title">Check in</h1>

      <Pass
        color={section.color}
        code={section.course}
        corner={<span className="mono">{today}</span>}
        title={section.name}
        headingLevel="h2"
        fields={[
          { label: 'Section', value: section.sectionNo, mono: true },
          { label: 'Room', value: section.room ?? '—' },
        ]}
      />

      {state.step !== 'located' && (
        <>
          <p className="footnote">
            We check that you're in the classroom. Your exact location is never stored, only how far you are from the
            room.
          </p>
          <Button className="button-block" onClick={shareLocation} disabled={asking} aria-busy={asking}>
            <LocationIcon />
            {asking ? 'Finding you…' : state.step === 'error' ? 'Try again' : 'Share my location'}
          </Button>
        </>
      )}

      {state.step === 'error' && (
        <div className="inline-alert" role="alert">
          <AlertIcon className="inline-alert-icon" />
          <div>
            <p className="inline-alert-title">{state.title}</p>
            <p className="inline-alert-text">{state.message}</p>
          </div>
        </div>
      )}

      {state.step === 'located' && (
        // For now this only confirms the location; recording attendance (and the
        // "Checked in" pass, see ?preview=done) arrives with task B6.
        <section className="result" aria-live="polite" aria-label="Result">
          <div className="result-card pass-enter">
            <CheckIcon className="result-icon" />
            <div>
              <p className="result-title">Location found</p>
              <p className="result-text">
                Accurate to <span className="mono">±{state.accuracy} m</span> at <span className="mono">{state.at}</span>.
              </p>
            </div>
          </div>
          <p className="footnote">Sample class. Recording attendance arrives with the check-in API; nothing was sent.</p>
        </section>
      )}

      {state.step === 'idle' && <p className="footnote">Sample class for now: the real one comes from the QR you scanned.</p>}
    </div>
  );
}
