// Login policy (ADR 0007): who may sign in, and what we create for them.
//
// Google proves *who* someone is (their ID token is signed by Google). This
// file decides whether that person is *allowed in*. It is plain logic with no
// HTTP or SQL in it, so the tests can check every rule with a fake store.

// What we keep from Google's ID token.
export interface GoogleIdentity {
  sub: string; // Google's permanent ID for the account. Never changes.
  email: string; // Can change (rare), so we only use it on first login.
  emailVerified: boolean;
  name?: string;
}

export interface StoredUser {
  id: string;
  email: string;
  googleSub: string | null; // null until the user's first login
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

// Everything the policy needs from the database. The real version is in
// userStore.ts; the tests use an in-memory one.
export interface UserStore {
  findByGoogleSub(sub: string): Promise<StoredUser | null>;
  findByEmail(email: string): Promise<StoredUser | null>;
  // Save the Google sub on a user an admin registered in advance.
  linkGoogleSub(userId: string, sub: string): Promise<void>;
  // In one transaction: make sure the users row, the students row and the
  // 'student' role exist. Returns null if the email already belongs to a
  // *different* Google account (different sub), which we refuse.
  upsertStudent(input: {
    email: string;
    sub: string;
    fullName: string;
    studentNo: string;
  }): Promise<StoredUser | null>;
  getProfile(userId: string): Promise<Profile | null>;
}

// 10 digits @g.siit.tu.ac.th. The 10 digits are the student number.
// Anchored with ^ and $ so "6722782164@g.siit.tu.ac.th.evil.com" doesn't match.
export const STUDENT_EMAIL = /^[0-9]{10}@g\.siit\.tu\.ac\.th$/;

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'NOT_REGISTERED' | 'EMAIL_NOT_VERIFIED' };

export async function applyLoginPolicy(
  identity: GoogleIdentity,
  users: UserStore,
): Promise<LoginResult> {
  // An unverified email could belong to anyone, so it proves nothing.
  if (!identity.emailVerified) return { ok: false, error: 'EMAIL_NOT_VERIFIED' };

  // Returning user: match by Google's sub, not by email (ADR 0007).
  const known = await users.findByGoogleSub(identity.sub);
  if (known) return { ok: true, userId: known.id };

  const email = identity.email.toLowerCase();

  // Rule 1: a SIIT student email may always sign in, as a student.
  // This is the ONLY role we ever create automatically. Instructor and admin
  // are granted by an admin, never derived from an email.
  if (STUDENT_EMAIL.test(email)) {
    const user = await users.upsertStudent({
      email,
      sub: identity.sub,
      fullName: identity.name?.trim() || email,
      studentNo: email.slice(0, 10), // the 10 digits before the @
    });
    return user ? { ok: true, userId: user.id } : { ok: false, error: 'NOT_REGISTERED' };
  }

  // Rule 2: any other email must already be registered by an admin.
  const registered = await users.findByEmail(email);
  if (registered && registered.googleSub === null) {
    await users.linkGoogleSub(registered.id, identity.sub);
    return { ok: true, userId: registered.id };
  }

  // Rule 3: everyone else. This also covers a registered email that is
  // already linked to a different Google account.
  return { ok: false, error: 'NOT_REGISTERED' };
}

// Where to send someone after login when there is no returnTo.
// These are the web app's home screens (docs/SCREENS.md).
export function homePathFor(roles: string[]): string {
  if (roles.includes('instructor') || roles.includes('admin')) return '/instructor';
  if (roles.includes('student')) return '/student';
  return '/';
}
