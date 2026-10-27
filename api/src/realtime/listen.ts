import pg from 'pg';

// One dedicated database connection that runs `LISTEN roster` for the whole
// API (task B5). It can't come from the pool: a pooled connection is lent out
// per query, but LISTEN must stay on one connection for as long as we listen.
//
// If the connection dies (the database restarts), try again every second. Any
// message sent while we were away is lost, so onReconnect tells the browsers
// to re-fetch the roster.
export interface RosterListener {
  close(): Promise<void>;
}

interface Log {
  warn(obj: object, msg: string): void;
}

const RETRY_MS = 1000;

export function listenToRoster(
  connectionString: string,
  onPayload: (payload: string) => void,
  onReconnect: () => void,
  log: Log,
): RosterListener {
  let closed = false;
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | undefined;
  let connectedBefore = false;

  async function connect() {
    if (closed) return;
    const c = new pg.Client({ connectionString });
    let lost = false;
    const onLost = (err?: Error) => {
      if (lost) return;
      lost = true;
      if (client === c) client = null;
      c.end().catch(() => {});
      if (closed) return;
      log.warn({ err }, 'roster listener lost its database connection, retrying');
      retry = setTimeout(connect, RETRY_MS);
    };
    c.on('error', onLost);
    c.on('end', () => onLost());
    c.on('notification', (m) => {
      if (m.channel === 'roster' && m.payload) onPayload(m.payload);
    });
    try {
      await c.connect();
      await c.query('LISTEN roster');
      if (closed) return void c.end().catch(() => {});
      client = c;
      if (connectedBefore) onReconnect();
      connectedBefore = true;
    } catch (err) {
      onLost(err as Error);
    }
  }

  void connect();

  return {
    async close() {
      closed = true;
      clearTimeout(retry);
      await client?.end().catch(() => {});
    },
  };
}
