import { fakeSections, fakeSession } from './fakeData';

// Sample data helper (deleted with fakeData.ts once the API lands): which
// section and how many check-ins a session URL shows. The live sample session
// is "demo"; "new-s2" means "a session just started for section s2".
export function sampleSession(id: string | undefined) {
  const isNew = id?.startsWith('new-') ?? false;
  const sectionId = isNew ? id!.slice('new-'.length) : fakeSession.sectionId;
  const section = fakeSections.find((s) => s.id === sectionId) ?? fakeSections[0];
  return {
    section,
    startedAt: isNew ? 'just now' : fakeSession.startedAt,
    checkedIn: isNew ? 0 : fakeSession.checkedIn,
  };
}
