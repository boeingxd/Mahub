import { useState } from 'react';
import { Button, Card } from '../ui';

// The page a student lands on after scanning the QR (and signing in).
export function CheckinPage() {
  const [message, setMessage] = useState('');

  // Temporary test: does this browser let us ask for location? Phones only
  // allow it over HTTPS (task B4 tests it on a real phone). Nothing is sent
  // anywhere yet; the real check-in call arrives with task B6.
  function testLocation() {
    if (!('geolocation' in navigator)) {
      setMessage('This browser has no location support.');
      return;
    }
    setMessage('Asking for your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => setMessage(`Location OK (accuracy about ${Math.round(pos.coords.accuracy)} m).`),
      (err) => setMessage(`Location failed: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <Card title="Check in">
      <p>We'll check that you're in the classroom. Your exact location is never stored.</p>
      <Button onClick={testLocation}>Share my location</Button>
      {message && <p className="muted">{message}</p>}
    </Card>
  );
}
