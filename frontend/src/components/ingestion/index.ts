/**
 * Ingestion Components
 *
 * Exports the ingestion wizard and its source/review pieces (Req 19).
 */

export { IngestionWizard } from './IngestionWizard'
export type { IngestionWizardProps } from './IngestionWizard'

export { WikipediaIngestTab } from './WikipediaIngestTab'
export type { WikipediaIngestTabProps } from './WikipediaIngestTab'

export { WikidataIngestTab } from './WikidataIngestTab'
export type { WikidataIngestTabProps } from './WikidataIngestTab'

export { TextIngestTab } from './TextIngestTab'
export type { TextIngestTabProps } from './TextIngestTab'

export { EntityReviewTable } from './EntityReviewTable'
export type { EntityReviewTableProps, ReviewEntity, ReviewEntityType } from './EntityReviewTable'
