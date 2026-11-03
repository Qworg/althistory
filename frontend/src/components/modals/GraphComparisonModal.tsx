import React from 'react'
import { BranchComparisonModal, BranchComparisonModalProps } from '@/components/branch/BranchComparisonModal'

export type GraphComparisonModalProps = BranchComparisonModalProps

/**
 * GraphComparisonModal provides backwards compatibility for existing modal invocations,
 * powered by the Compare branches dialog (BranchComparisonModal).
 */
export const GraphComparisonModal: React.FC<GraphComparisonModalProps> = (props) => {
  return <BranchComparisonModal {...props} />
}