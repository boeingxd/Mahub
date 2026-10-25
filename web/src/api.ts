import { useEffect, useState } from 'react';

// Talking to the API. Every screen asks for its data the same way, with the
// same three states: loading, error (with a code we turn into words) and done.
// Error codes are listed in docs/API.md.

export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type ApiState<T> = { status: 'loading' } | { status: 'error'; code: string } | { status: 'done'; data: T };

// The browser calls /api/...; Caddy strips the /api before the request reaches the API.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('NETWORK'); // no answer at all: offline, or the server is down
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Gateway errors mean "the API behind Caddy isn't answering".
    const fallback = res.status === 502 || res.status === 503 || res.status === 504 ? 'NETWORK' : 'INTERNAL';
    throw new ApiError(typeof body?.error === 'string' ? body.error : fallback);
  }
  return res.json();
}

export const apiGet = <T>(path: string) => request<T>(path);

// POST with an optional JSON body. (No body means no content-type either: the
// API rejects "JSON" with nothing in it.)
export const apiPost = <T>(path: string, body?: unknown) =>
  request<T>(
    path,
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );

export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : 'INTERNAL');

// Fetches `path` when the screen opens (and again on retry()).
// refreshMs: ask again every so often, quietly. A failed refresh keeps showing the
// last good data instead of an error. (shortcut: polling until the live WebSocket,
// task B5, lands.)
export function useApi<T>(path: string, refreshMs?: number) {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false; // true once the screen has moved on, so an old answer is ignored
    const load = (quiet: boolean) =>
      apiGet<T>(path).then(
        (data) => !stale && setState({ status: 'done', data }),
        (e) => !stale && !quiet && setState({ status: 'error', code: errorCode(e) }),
      );
    load(false);
    const timer = refreshMs ? setInterval(() => load(true), refreshMs) : undefined;
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [path, attempt, refreshMs]);

  // Ask again without flashing "Loading…" (e.g. after the instructor marks a student).
  const refresh = () => setAttempt((n) => n + 1);
  // Assumes `path` stays the same while the screen is open (it does for every screen so far).
  const retry = () => {
    setState({ status: 'loading' });
    refresh();
  };
  return { state, retry, refresh };
}

// What the screen tells the person for each error code. Never the raw error.
export const errorText: Record<string, { title: string; message: string }> = {
  NETWORK: { title: "Can't reach Mahub", message: 'Check your connection and try again.' },
  UNAUTHENTICATED: { title: 'Please sign in', message: 'Your sign-in has ended or you have not signed in yet.' },
  FORBIDDEN: { title: 'Not allowed', message: "You don't have access to that." },
  BAD_REQUEST: { title: 'Something was wrong with that request', message: 'Go back and try again.' },
  NOT_FOUND: { title: 'Not found', message: "That class or check-in doesn't exist, or it isn't yours." },
  NOT_ENROLLED: { title: 'Not in this class', message: "That student isn't enrolled in this section." },
  ROOM_NOT_FOUND: { title: 'Room not found', message: 'Pick a room from the list and try again.' },
  SESSION_ALREADY_OPEN: { title: 'Already open', message: 'This class already has a check-in open.' },
  SESSION_CLOSED: { title: 'Already closed', message: 'This check-in has already ended.' },
  INTERNAL: { title: 'Something went wrong on our side', message: 'Try again in a moment.' },
};

// Shapes from docs/API.md and GET /api/me.
export interface Me {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

export interface MySection {
  id: string;
  course_code: string;
  course_name: string;
  term: string;
  section_no: number;
  enrolled: number;
  open_session_id: string | null;
}

export interface ClassSession {
  id: string;
  section_id: string;
  room_id: string;
  radius_m: number;
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
}

export interface RosterStudent {
  student_id: string;
  student_no: string;
  full_name: string;
  status: 'present' | 'excused' | 'absent';
  method: 'qr' | 'manual' | null;
  recorded_at: string | null;
}

export interface Roster {
  counts: { enrolled: number; present: number; excused: number; absent: number };
  students: RosterStudent[];
}

export interface QrAnswer {
  url: string; // what the phone camera opens
  window: number;
  expires_in: number; // seconds until the QR changes
  server_time: string;
}

// The first of several answers that isn't ready yet (still loading, or failed). Pages wait on all of them.
export const firstNotDone = (...states: ApiState<unknown>[]) => states.find((s) => s.status !== 'done');

export interface Room {
  id: string;
  name: string;
}
