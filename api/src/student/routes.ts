import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StudentStore } from './studentStore.js';

export interface StudentOptions {
  store: StudentStore;
}

// z.guid(), not z.uuid(): the seeded ids aren't strict RFC UUIDs.
const SectionParams = z.object({ section_id: z.guid() });

// None of these endpoints takes a student id: who is asking comes from the
// login cookie only, so a student can't ask about someone else.
// Must be registered in the same scope as registerAuth (it uses its login cookie).
export async function registerStudent(app: FastifyInstance, { store }: StudentOptions) {
  // My classes, with my rate in each.
  app.get('/my/classes', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return store.classes(userId);
  });

  // The overview screen in one request.
  app.get('/my/overview', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return store.overview(userId);
  });

  // Every window of one class I'm in, and what happened to me in each.
  app.get('/my/classes/:section_id/sessions', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = SectionParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.classSessions(userId, params.data.section_id);
    return result.ok ? result.detail : reply.code(403).send({ error: result.error });
  });
}
