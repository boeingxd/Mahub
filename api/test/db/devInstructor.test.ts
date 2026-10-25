// "Make this email an instructor" (scripts/dev-instructor.ts) against the real
// database. It must use sections of its own: the seeded ones are shared with
// other test files running at the same time.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { registerDevInstructor, SEED_SECTIONS } from '../../scripts/dev-instructor.js';
import { createUserStore } from '../../src/auth/userStore.js';
import { createSectionsStore } from '../../src/sections/sectionsStore.js';

const testDb = inject('testDb');

const INSTRUCTOR_1 = '00000000-0000-0000-0000-0000000000b1';
const COURSE_D1 = '00000000-0000-0000-0000-0000000000d1'; // ITS332
const COURSE_D2 = '00000000-0000-0000-0000-0000000000d2'; // ITS323

describe.skipIf(!testDb)('register a dev instructor', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let n = 300;

  const newSection = async (course: string) =>
    (
      await admin.query(
        `INSERT INTO api.sections (course_id, term, section_no, instructor_id)
         VALUES ($1, '2026-4', $2, $3) RETURNING id`,
        [course, n++, INSTRUCTOR_1],
      )
    ).rows[0].id as string;

  async function register(email: string, sections: string[]) {
    const client = await admin.connect();
    try {
      return await registerDevInstructor(client, email, sections);
    } finally {
      client.release();
    }
  }

  beforeAll(() => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    app = new pg.Pool({ connectionString: testDb!.appUrl });
  });
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('the seeded sections it targets are the two in the seed: ITS332 section 1 and ITS323 section 1', async () => {
    const { rows } = await admin.query(
      `SELECT c.code, s.section_no FROM api.sections s JOIN api.courses c ON c.id = s.course_id
       WHERE s.id = ANY($1::uuid[]) ORDER BY c.code`,
      [SEED_SECTIONS],
    );
    expect(rows).toEqual([
      { code: 'ITS323', section_no: 1 },
      { code: 'ITS332', section_no: 1 },
    ]);
  });

  it('makes the email an instructor who teaches those sections, and can sign in', async () => {
    const [a, b] = [await newSection(COURSE_D1), await newSection(COURSE_D2)];
    const res = await register('Dev-Teacher@Example.Test', [a, b]);
    expect(res.sectionsUpdated).toBe(2);

    // Sign-in looks the person up by email (ADR 0007): they must be found, case-insensitively.
    const users = createUserStore(app);
    const found = await users.findByEmail('dev-teacher@example.test');
    expect(found).toMatchObject({ id: res.userId, googleSub: null }); // still has to sign in with Google once
    expect(await users.getProfile(res.userId)).toMatchObject({ roles: ['instructor'] });

    // And the instructor dashboard shows both classes.
    const mine = await createSectionsStore(app).listMine(res.userId);
    expect(mine.filter((s) => [a, b].includes(s.id)).map((s) => s.course_code).sort()).toEqual(['ITS323', 'ITS332']);
  });

  it('can be run again and again without making duplicates', async () => {
    const s = await newSection(COURSE_D1);
    const first = await register('twice@example.test', [s]);
    const second = await register('TWICE@example.test', [s]);
    expect(second.userId).toBe(first.userId);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.user_roles WHERE user_id = $1', [first.userId]);
    expect(rows[0].n).toBe(1);
  });

  it('adds the instructor role to someone who already exists (a student keeps being a student)', async () => {
    const existing = (
      await admin.query(`INSERT INTO api.users (email, full_name) VALUES ('already@example.test', 'Already Here') RETURNING id`)
    ).rows[0].id;
    await admin.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'student')`, [existing]);

    const res = await register('already@example.test', []);
    expect(res.userId).toBe(existing);
    const profile = await createUserStore(app).getProfile(existing);
    expect(profile).toMatchObject({ fullName: 'Already Here' }); // their name is not overwritten
    expect([...profile!.roles].sort()).toEqual(['instructor', 'student']); // order is the database's, not ours
  });

  it('only touches the sections it is given', async () => {
    const mine = await newSection(COURSE_D1);
    const notMine = await newSection(COURSE_D2);
    await register('focused@example.test', [mine]);
    const { rows } = await admin.query('SELECT id, instructor_id FROM api.sections WHERE id = ANY($1::uuid[])', [[mine, notMine]]);
    const owner = Object.fromEntries(rows.map((r) => [r.id, r.instructor_id]));
    expect(owner[notMine]).toBe(INSTRUCTOR_1);
    expect(owner[mine]).not.toBe(INSTRUCTOR_1);
  });

  it('reports a section id that does not exist instead of pretending it worked', async () => {
    const res = await register('ghost@example.test', ['44444444-4444-4444-4444-444444444444']);
    expect(res.sectionsUpdated).toBe(0);
  });
});
