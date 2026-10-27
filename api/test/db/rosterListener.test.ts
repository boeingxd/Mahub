// The API's LISTEN connection (task B5), against a real database. It sends a
// bare pg_notify, so no attendance rows are written and other test files are
// not affected.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { listenToRoster, type RosterListener } from '../../src/realtime/listen.js';

const testDb = inject('testDb');

describe.skipIf(!testDb)('roster listener', () => {
  let admin: pg.Pool;
  let listener: RosterListener;
  const heard: string[] = [];
  let reconnects = 0;

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };
  const notify = (text: string) => admin.query("SELECT pg_notify('roster', $1)", [text]);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    // As the app user, like the real API.
    listener = listenToRoster(testDb!.appUrl, (p) => heard.push(p), () => reconnects++, { warn() {} });
    // LISTEN is on once a first message gets through.
    await until(() => {
      void notify('ready');
      return heard.includes('ready');
    });
  });

  afterAll(async () => {
    await listener?.close();
    await admin?.end();
  });

  it('passes on what the database broadcasts', async () => {
    await notify('hello from the test');
    await until(() => heard.includes('hello from the test'));
  });

  it('reconnects by itself after its connection is killed, and says so', async () => {
    expect(reconnects).toBe(0);
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = 'LISTEN roster' AND datname = current_database()`);
    await until(() => reconnects === 1);
    await notify('after the restart');
    await until(() => heard.includes('after the restart'));
  });
});
