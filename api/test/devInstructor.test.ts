// The checks around the local-only "make this email an instructor" script
// (scripts/dev-instructor.ts). The part that touches the database is tested in
// test/db/devInstructor.test.ts.
import { describe, expect, it } from 'vitest';
import { assertLocalDatabase, parseEmail } from '../scripts/dev-instructor.js';

describe('parseEmail', () => {
  it('accepts a normal address and lower-cases it', () => {
    expect(parseEmail('  Somebody@Gmail.COM ')).toBe('somebody@gmail.com');
  });

  it('refuses things that are not one email address', () => {
    for (const bad of [undefined, '', '   ', 'no-at-sign', 'two@@signs.com', 'a@b@c.com', 'sp ace@x.com', 'a@x.com,b@x.com', 'a@x.com\nb@x.com', '@x.com', 'a@']) {
      expect(() => parseEmail(bad), String(bad)).toThrow(/email/i);
    }
  });
});

describe('assertLocalDatabase (a dev script must never touch a real server)', () => {
  it('accepts this laptop and the Compose database', () => {
    for (const url of [
      'postgres://postgres:x@localhost:15432/mahub',
      'postgres://postgres:x@127.0.0.1:5432/mahub?sslmode=disable',
      'postgres://postgres:x@[::1]:5432/mahub',
      'postgres://postgres:x@db:5432/mahub',
    ]) {
      expect(() => assertLocalDatabase(url), url).not.toThrow();
    }
  });

  it('refuses any other host', () => {
    for (const url of [
      'postgres://postgres:x@db.example.com:5432/mahub',
      'postgres://postgres:x@10.0.0.5:5432/mahub',
      'postgres://postgres:x@localhost.evil.com:5432/mahub',
      'postgres://postgres:x@mahub.abc123.eu-west-1.rds.amazonaws.com:5432/mahub',
    ]) {
      expect(() => assertLocalDatabase(url), url).toThrow(/local/i);
    }
  });

  it('refuses a missing or garbled address', () => {
    expect(() => assertLocalDatabase(undefined)).toThrow();
    expect(() => assertLocalDatabase('not a url')).toThrow();
  });

  it('never repeats the password in its error message', () => {
    try {
      assertLocalDatabase('postgres://postgres:hunter2secret@db.example.com:5432/mahub');
      throw new Error('should have thrown');
    } catch (err) {
      expect(String(err)).not.toContain('hunter2secret');
    }
  });
});
