import type { ReactElement } from 'react'
import type { DroppedRows } from '@/types'

type Reason = DroppedRows['reasons'][number]

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "3 Wikidata results (1 item)", with the singular right. */
function counted(entry: Pick<Reason, 'count' | 'items'>): string {
  const results = plural(entry.count, 'Wikidata result', 'Wikidata results')
  return entry.items > 0 ? `${results} (${plural(entry.items, 'item', 'items')})` : results
}

function ItemLinks({ entry }: { entry: Reason }): ReactElement | null {
  if (entry.itemIds.length === 0) return null
  const more = entry.items - entry.itemIds.length
  const links = (
    <>
      {entry.itemIds.map((id, index) => (
        <span key={id}>
          {index > 0 && ', '}
          <a href={`https://www.wikidata.org/wiki/${id}`} target="_blank" rel="noreferrer" className="underline">
            {id}
          </a>
        </span>
      ))}
      {more > 0 && ` and ${more} more`}
    </>
  )
  // A short list sits inline; a long one folds away.
  if (entry.itemIds.length <= 3) return <span className="ml-1 text-ink-secondary">({links})</span>
  return (
    <details className="mt-1 text-xs text-ink-secondary">
      <summary className="cursor-pointer">Show the items</summary>
      <p className="mt-1">{links}</p>
    </details>
  )
}

/**
 * The Wikidata results an extraction left out, and why: a date beyond the
 * timeline, no date, one that could not be read. Without it a result that
 * vanished looked the same as one that was never there. A result is one row of
 * the query's answer (one per place of an item), not a row of the review table.
 */
export function DroppedRowsNotice({ droppedRows }: { droppedRows: DroppedRows }): ReactElement {
  const { total, reasons } = droppedRows
  const single = reasons.length === 1 ? reasons[0] : null
  return (
    <div className="mb-4 rounded-md border border-line bg-subtle p-3 text-sm text-ink" role="status" data-testid="dropped-rows-notice">
      {single ? (
        <p>
          {counted(single)} {single.count === 1 ? 'was' : 'were'} left out: {single.description}
          <ItemLinks entry={single} />
        </p>
      ) : (
        <>
          <p>
            {plural(total, 'Wikidata result', 'Wikidata results')} {total === 1 ? 'was' : 'were'} left out:
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-ink-secondary">
            {reasons.map((entry) => (
              <li key={entry.reason}>
                {counted(entry)}: {entry.description}
                <ItemLinks entry={entry} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
