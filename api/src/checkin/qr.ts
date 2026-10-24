import { createHmac, timingSafeEqual } from 'node:crypto';

// The rotating QR (task Y3, PROJECT_PLAN.md §5.1).
//
// Time is cut into 10-second "windows": window = floor(seconds / 10).
// The QR for a check-in window is a signature of "<class_session_id>:<window>"
// made with QR_SECRET, which only the server knows:
//
//   token = base64url(HMAC-SHA256(QR_SECRET, id + ":" + window)), first 16 characters
//
// Nothing is stored. To check a scanned token, the server makes the token
// again and compares. Rotating the QR therefore costs zero database writes
// (the old app wrote a row every 10 s). Without QR_SECRET nobody can make a
// valid token, and the session id is part of the signature, so one session's
// token never works for another.

export const WINDOW_SECONDS = 10;
const TOKEN_LENGTH = 16; // 16 base64url characters = 96 bits: far too many to guess

export function windowAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / WINDOW_SECONDS);
}

export function makeToken(secret: string, classSessionId: string, window: number): string {
  return createHmac('sha256', secret)
    .update(`${classSessionId}:${window}`)
    .digest('base64url')
    .slice(0, TOKEN_LENGTH);
}

// Accept the previous, current and next window, so a slightly wrong phone
// clock or a slow scan still works. A token is valid for 20–30 s, so a photo
// forwarded to a friend at home expires almost straight away.
export function verifyToken(
  secret: string,
  classSessionId: string,
  window: number,
  token: string,
  nowMs: number,
): boolean {
  const now = windowAt(nowMs);
  if (!Number.isInteger(window) || Math.abs(window - now) > 1) return false;

  const expected = Buffer.from(makeToken(secret, classSessionId, window));
  const given = Buffer.from(token);
  // timingSafeEqual takes the same time however many characters match, so an
  // attacker can't guess the token one character at a time by measuring how
  // long each wrong guess takes. (It needs equal lengths, so check that first.)
  return given.length === expected.length && timingSafeEqual(given, expected);
}
