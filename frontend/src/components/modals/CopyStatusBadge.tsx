import type { CopyOperation } from '@/types'

const STATUS_CLASSES: Record<CopyOperation['status'], string> = {
  pending: 'text-amber-800 bg-amber-100 dark:text-amber-200 dark:bg-amber-500/15',
  in_progress: 'text-blue-800 bg-blue-100 dark:text-blue-200 dark:bg-blue-500/15',
  completed: 'text-green-800 bg-green-100 dark:text-green-200 dark:bg-green-500/15',
  failed: 'text-red-800 bg-red-100 dark:text-red-200 dark:bg-red-500/15',
}

const STATUS_LABELS: Record<CopyOperation['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
}

const STATUS_PATHS: Record<CopyOperation['status'], string> = {
  pending: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  in_progress: 'M12 3a9 9 0 109 9',
  completed: 'M5 13l4 4L19 7',
  failed: 'M6 18L18 6M6 6l12 12',
}

/** The status of a copy: a drawn icon and a word, never colour alone. */
export function CopyStatusBadge({ status }: { status: CopyOperation['status'] }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      <svg
        className={`w-3.5 h-3.5 ${status === 'in_progress' ? 'animate-spin motion-reduce:animate-none' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={STATUS_PATHS[status]} />
      </svg>
      {STATUS_LABELS[status]}
    </span>
  )
}
