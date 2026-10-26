// Old bug 8: raw GPS coordinates were kept forever.
// Fix (ADR 0006): use the student's lat/lng only to compute a distance, then
// forget them. Store only distance_m and gps_accuracy_m. Never store IPs.
import { afterAll, describe, expect, inject, it } from 'vitest';
import { pools } from './helpers.js';

const testDb = inject('testDb');

describe.skipIf(!testDb)('old bug 8: raw GPS kept forever', () => {
  const { admin, app } = testDb ? pools(testDb) : ({} as ReturnType<typeof pools>);
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  // Our schemas only (PostGIS adds its own tables elsewhere).
  const OURS = `table_schema IN ('api', 'private', 'audit')`;

  it('no column is named like a coordinate or an IP address', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema, table_name, column_name FROM information_schema.columns
       WHERE ${OURS} AND column_name ~* '(^|_)(lat|lng|lon|latitude|longitude|coords?|ip|ip_address|inet)($|_)'`,
    );
    expect(rows).toEqual([]);
  });

  it('no column has an IP address type', async () => {
    const { rows } = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE ${OURS} AND data_type IN ('inet', 'cidr')`,
    );
    expect(rows).toEqual([]);
  });

  it('the only places are rooms (and the copy of the room in each window), never people', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS col FROM information_schema.columns
       WHERE ${OURS} AND udt_name IN ('geography', 'geometry') ORDER BY 1`,
    );
    expect(rows.map((r) => r.col)).toEqual(['api.class_sessions.location', 'api.rooms.location']);
  });
});
