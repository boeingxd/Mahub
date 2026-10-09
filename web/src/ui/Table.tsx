import type { ReactNode } from 'react';

export interface Column<Row> {
  header: string;
  // How to show this column for one row: plain text or any component (e.g. a Badge).
  cell: (row: Row) => ReactNode;
  // Optional: hide this column on phone-width screens to keep the table readable.
  hideOnPhone?: boolean;
}

interface TableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  // A unique value per row. React needs it to update lists efficiently.
  rowKey: (row: Row) => string;
  empty?: string;
}

// A simple data table, styled like a grouped list. Generic (<Row>) so it works
// for any kind of row: students, sections, attempts...
export function Table<Row>({ columns, rows, rowKey, empty = 'Nothing here yet.' }: TableProps<Row>) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={c.hideOnPhone ? 'hide-on-phone' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.header} className={c.hideOnPhone ? 'hide-on-phone' : undefined}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
