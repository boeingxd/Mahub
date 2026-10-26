// The live roster in the browser (task B5). Opens a WebSocket to the API,
// subscribes to one check-in window, and calls `onChange` whenever something
// happened, so the screen asks the API for the roster again. The message does
// not carry the roster itself: the roster endpoint stays the one source of
// truth, which also makes missed messages harmless.
//
// If the connection drops (Wi-Fi blip, the API restarts), it tries again after
// 1 s, 2 s, 4 s ... up to 30 s, and calls `onChange` once it is back, because
// messages sent in between are lost.

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;
// A burst of check-ins (a whole class scans at once) becomes one refresh, not 300.
const SETTLE_MS = 250;

export function watchRoster(classSessionId: string, onChange: () => void): () => void {
  let socket: WebSocket | undefined;
  let stopped = false;
  let retryMs = FIRST_RETRY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const changed = () => {
    if (settleTimer) return; // a refresh is already on its way
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (!stopped) onChange();
    }, SETTLE_MS);
  };

  function connect() {
    // Same address as the page, so it goes through Caddy like everything else.
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket = ws;

    ws.onopen = () => ws.send(JSON.stringify({ subscribe: classSessionId }));
    ws.onmessage = (event) => {
      let message: { type?: string; subscribed?: string; error?: string };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.subscribed) {
        retryMs = FIRST_RETRY_MS; // a working connection: forget the backoff
        changed(); // (re)connected: catch up on anything we missed
      } else if (message.type === 'roster' || message.type === 'resync') {
        changed();
      }
      // { error } (not the instructor, window gone): nothing to show. The
      // screen still refreshes itself slowly (useLiveSession), so it keeps working.
    };
    ws.onclose = () => {
      if (stopped) return;
      reconnectTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    };
    // onerror is always followed by onclose, which does the retrying.
  }

  connect();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(settleTimer);
    socket?.close();
  };
}
