import { useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { type FakeRosterRow, type RosterStatus } from '../fakeData';
import { ActionSheet, Badge, Table, type BadgeTone, type Column, type SheetAction } from '../ui';

const statusTone: Record<RosterStatus, BadgeTone> = {
  present: 'success',
  excused: 'neutral',
  absent: 'danger',
};

const statusLabel: Record<RosterStatus, string> = {
  present: 'Present',
  excused: 'Excused',
  absent: 'Absent',
};

// A student's status right now, and whether a person set it by hand
// (attendance.method = 'manual') rather than a QR scan.
interface Mark {
  status: RosterStatus;
  manual: boolean;
}

// What the scans alone say: present if they checked in by QR, otherwise absent.
function scanned(r: FakeRosterRow): RosterStatus {
  return r.manual ? 'absent' : r.status;
}

// The roster: everyone enrolled, and whether they checked in. Shown on the
// instructor's laptop during a session (live) and on the summary afterwards,
// never on the projector (the class shouldn't see who's missing).
//
// "Change" lets the instructor mark a student by hand: present (e.g. their
// phone died) or excused (e.g. a medical note). For now marks live only in
// this page; saving them arrives with task P4.
export function RosterTable({ rows, live = false }: { rows: FakeRosterRow[]; live?: boolean }) {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [editing, setEditing] = useState<FakeRosterRow | null>(null);

  const current = (r: FakeRosterRow): Mark => marks[r.studentNo] ?? { status: r.status, manual: !!r.manual };

  function setMark(r: FakeRosterRow, mark: Mark) {
    setMarks((m) => ({ ...m, [r.studentNo]: mark }));
    setEditing(null);
  }

  const columns: Column<FakeRosterRow>[] = [
    { header: 'Student no.', cell: (r) => <span className="mono">{r.studentNo}</span>, hideOnPhone: true },
    {
      header: 'Name',
      // On a phone the student-number column is hidden, so the number goes under the name.
      cell: (r) => (
        <span className="name-cell">
          {r.name}
          <span className="mono muted show-on-phone">{r.studentNo}</span>
        </span>
      ),
    },
    { header: 'Time', cell: (r) => <span className="mono muted">{r.time ?? '—'}</span>, hideOnPhone: true },
    {
      header: 'Status',
      // While check-in is still open, nobody is "absent" yet, only "not checked
      // in". A mark made by hand says so, so the instructor can tell it from a scan.
      cell: (r) => {
        const m = current(r);
        return (
          <span className="status-cell">
            {live && m.status === 'absent' ? (
              <Badge tone="neutral">Not checked in</Badge>
            ) : (
              <Badge tone={statusTone[m.status]}>{statusLabel[m.status]}</Badge>
            )}
            {m.manual && <span className="status-note">Marked by hand</span>}
          </span>
        );
      },
    },
    {
      header: 'Mark',
      cell: (r) => (
        <button type="button" className="row-action" onClick={() => setEditing(r)} aria-label={`Change status for ${r.name}`}>
          Change
        </button>
      ),
    },
  ];

  // The choices offered depend on the student's current status.
  const actions: SheetAction[] = [];
  if (editing) {
    const m = current(editing);
    if (m.status !== 'present') actions.push({ label: 'Mark present', onSelect: () => setMark(editing, { status: 'present', manual: true }) });
    if (m.status !== 'excused') actions.push({ label: 'Mark excused', onSelect: () => setMark(editing, { status: 'excused', manual: true }) });
    if (m.manual)
      actions.push({
        label: 'Clear mark',
        destructive: true,
        onSelect: () => setMark(editing, { status: scanned(editing), manual: false }),
      });
  }

  return (
    <>
      <Table columns={columns} rows={rows} rowKey={(r) => r.studentNo} empty="No one is enrolled in this section." />
      <ActionSheet
        open={editing !== null}
        title={editing ? `${editing.name} · ${editing.studentNo}` : ''}
        message="Sample data: marks aren't saved yet (task P4)."
        actions={actions}
        onCancel={() => setEditing(null)}
      />
    </>
  );
}

// The roster now lives inside the session screen. Old links still work.
export function RosterPage() {
  const { id } = useParams();
  return <Navigate to={`/session/${id ?? ''}`} replace />;
}
