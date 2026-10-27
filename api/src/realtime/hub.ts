import { z } from 'zod';

// The hub is the switchboard of the live roster (task B5): browsers subscribe
// to one check-in window, and every roster message from the database for that
// window is forwarded to them. No sockets and no SQL in here, so it is easy to test.

// What the trigger in db/migrations/*_roster_notify.sql sends (docs/API.md).
const RosterMessage = z.object({
  class_session_id: z.guid(),
  student_id: z.guid(),
  status: z.enum(['present', 'excused']),
});

// Anything the hub can send text to: a WebSocket in production.
export interface Sender {
  send(text: string): void;
}

export interface RosterHub {
  // Start sending this window's messages to `sender`.
  subscribe(classSessionId: string, sender: Sender): void;
  // Stop sending anything to `sender` (its socket closed).
  unsubscribeAll(sender: Sender): void;
  // A text from the database's NOTIFY. Bad text is ignored, never thrown.
  publish(payload: string): void;
  // Tell everyone to re-fetch the roster: we may have missed messages (the
  // database connection was down for a moment).
  resync(): void;
  subscriberCount(classSessionId: string): number;
}

export function createRosterHub(): RosterHub {
  const watchers = new Map<string, Set<Sender>>();

  // One bad socket must not stop the others from getting their message.
  const sendTo = (sender: Sender, message: object) => {
    try {
      sender.send(JSON.stringify(message));
    } catch {
      /* the socket is closing; its close handler will remove it */
    }
  };

  return {
    subscribe(classSessionId, sender) {
      const set = watchers.get(classSessionId) ?? new Set();
      set.add(sender);
      watchers.set(classSessionId, set);
    },
    unsubscribeAll(sender) {
      for (const [id, set] of watchers) {
        set.delete(sender);
        if (set.size === 0) watchers.delete(id);
      }
    },
    publish(payload) {
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const message = RosterMessage.safeParse(json);
      if (!message.success) return;
      for (const sender of watchers.get(message.data.class_session_id) ?? []) {
        sendTo(sender, { type: 'roster', ...message.data });
      }
    },
    resync() {
      for (const set of watchers.values()) for (const sender of set) sendTo(sender, { type: 'resync' });
    },
    subscriberCount: (classSessionId) => watchers.get(classSessionId)?.size ?? 0,
  };
}
