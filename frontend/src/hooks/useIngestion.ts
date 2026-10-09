/**
 * useIngestion Hook
 *
 * React Query hooks for the web-ingestion API (Req 19). Extraction is
 * synchronous -- each POST resolves the review preview directly -- so the source
 * hooks are mutations, not jobs to poll.
 */

import { useMutation, UseMutationOptions } from '@tanstack/react-query'
import { apiClient, APIError } from '@/services/api'
import type {
  IngestResponse,
  ImportResult,
  ApproveIngestionRequest,
  WikipediaIngestRequest,
  WikidataIngestRequest,
  TextIngestRequest,
} from '@/types'

/** Hook for extracting entities from a Wikipedia URL. */
export function useIngestWikipedia(
  options?: UseMutationOptions<IngestResponse, APIError, WikipediaIngestRequest>
) {
  return useMutation({
    mutationFn: (request: WikipediaIngestRequest) => apiClient.ingest.url(request),
    ...options,
  })
}

/** Hook for extracting entities from Wikidata. */
export function useIngestWikidata(
  options?: UseMutationOptions<IngestResponse, APIError, WikidataIngestRequest>
) {
  return useMutation({
    mutationFn: (request: WikidataIngestRequest) => apiClient.ingest.wikidata(request),
    ...options,
  })
}

/** Hook for extracting entities from pasted text. */
export function useIngestText(
  options?: UseMutationOptions<IngestResponse, APIError, TextIngestRequest>
) {
  return useMutation({
    mutationFn: (request: TextIngestRequest) => apiClient.ingest.text(request),
    ...options,
  })
}

export interface ApproveIngestionArgs {
  jobId: string
  request: ApproveIngestionRequest
}

/** Hook for approving a reviewed extraction and importing the selection. */
export function useApproveIngestion(
  options?: UseMutationOptions<ImportResult, APIError, ApproveIngestionArgs>
) {
  return useMutation({
    mutationFn: ({ jobId, request }: ApproveIngestionArgs) =>
      apiClient.ingest.approve(jobId, request),
    ...options,
  })
}

/** Hook for discarding a review job. */
export function useDeleteIngestionJob(
  options?: UseMutationOptions<{ success: boolean }, APIError, string>
) {
  return useMutation({
    mutationFn: (jobId: string) => apiClient.ingest.deleteJob(jobId),
    ...options,
  })
}
