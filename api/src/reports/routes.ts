import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toCsv } from './csv.js';
import type { ReportsError, ReportsStore } from './reportsStore.js';

export interface ReportsOptions {
  store: ReportsStore;
}

// z.guid(), not z.uuid(): the seeded ids aren't strict RFC UUIDs.
const IdParams = z.object({ id: z.guid() });
const ReportQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });
// strictObject: extra fields are refused. In particular the browser can't send
// its own `recorded_by`: the server signs the mark with the logged-in instructor.
// "absent" is not a choice: absent is simply having no row.
const MarkBody = z.strictObject({ student_id: z.guid(), status: z.enum(['present', 'excused']) });

const STATUS: Record<ReportsError, number> = { FORBIDDEN: 403, NOT_ENROLLED: 404 };

// Must be registered in the same scope as registerAuth (it uses its login cookie).
export async function registerReports(app: FastifyInstance, { store }: ReportsOptions) {
  // Who's present, excused and absent in one check-in window.
  app.get('/class-sessions/:id/roster', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.roster(userId, params.data.id);
    return result.ok ? result.roster : reply.code(STATUS[result.error]).send({ error: result.error });
  });

  // Each student's attendance rate for a section, as JSON or a CSV download.
  app.get('/sections/:id/report', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = IdParams.safeParse(request.params);
    const query = ReportQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.report(userId, params.data.id);
    if (!result.ok) return reply.code(STATUS[result.error]).send({ error: result.error });
    if (query.data.format === 'json') return result.rows;

    const csv = toCsv(
      ['student_no', 'full_name', 'sessions_held', 'attended', 'excused', 'rate_pct'],
      result.rows.map((r) => [r.student_no, r.full_name, r.sessions_held, r.attended, r.excused, r.rate_pct]),
    );
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      // The id was checked by zod, so it can't hold anything that breaks the header.
      .header('content-disposition', `attachment; filename="attendance-${params.data.id}.csv"`)
      .send(csv);
  });

  // The instructor sets a student present or excused by hand.
  app.post('/class-sessions/:id/attendance', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = IdParams.safeParse(request.params);
    const body = MarkBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.mark(userId, params.data.id, body.data.student_id, body.data.status);
    return result.ok ? result.attendance : reply.code(STATUS[result.error]).send({ error: result.error });
  });
}
