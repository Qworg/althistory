import type { DroppedRows } from '@/types'

/**
 * The Wikidata rows an extraction left out, and why: a date beyond the
 * timeline, no date, one that could not be read. Without it a row that
 * vanished looked the same as a row that was never there.
 */
export function DroppedRowsNotice({ droppedRows }: { droppedRows: DroppedRows }) {
  const { total, reasons } = droppedRows
  const head = total === 1 ? '1 row was left out' : `${total} rows were left out`
  const single = reasons.length === 1 ? reasons[0] : null
  return (
    <div className="mb-4 rounded-md border border-line bg-subtle p-3 text-sm text-ink" role="status" data-testid="dropped-rows-notice">
      {single ? (
        <p>
          {head}: {single.description}
        </p>
      ) : (
        <>
          <p>{head}:</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-ink-secondary">
            {reasons.map((entry) => (
              <li key={entry.reason}>
                {entry.count}: {entry.description}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
