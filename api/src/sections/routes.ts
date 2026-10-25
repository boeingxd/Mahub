import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SectionsError, SectionsStore } from './sectionsStore.js';

export interface SectionsOptions {
  store: SectionsStore;
}

// z.guid(), not z.uuid(): the seeded ids (00000000-...-0000e1) aren't strict
// RFC UUIDs, and z.uuid() would refuse them.
const IdParams = z.object({ id: z.guid() });
// strictObject: a body with extra fields is refused instead of silently ignored.
const OpenBody = z.strictObject({ room_id: z.guid() });

const STATUS: Record<SectionsError, number> = {
  FORBIDDEN: 403,
  ROOM_NOT_FOUND: 404,
  SESSION_ALREADY_OPEN: 409,
  SESSION_CLOSED: 409,
};

// Must be registered in the same scope as registerAuth (it uses its login cookie).
export async function registerSections(app: FastifyInstance, { store }: SectionsOptions) {
  // The instructor's sections, for the "My classes" screen.
  app.get('/my/sections', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return store.listMine(userId);
  });

  // Open a check-in window.
  app.post('/sections/:id/class-sessions', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = IdParams.safeParse(request.params);
    const body = OpenBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.open(userId, params.data.id, body.data.room_id);
    return result.ok ? reply.code(201).send(result.session) : reply.code(STATUS[result.error]).send({ error: result.error });
  });

  // Close a check-in window.
  app.post('/class-sessions/:id/close', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.close(userId, params.data.id);
    return result.ok ? result.session : reply.code(STATUS[result.error]).send({ error: result.error });
  });

  // One window, for the live-session screen.
  app.get('/class-sessions/:id', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    const result = await store.get(userId, params.data.id);
    return result.ok ? result.session : reply.code(STATUS[result.error]).send({ error: result.error });
  });
}
