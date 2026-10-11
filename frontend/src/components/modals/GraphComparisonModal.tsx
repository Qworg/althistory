import React from 'react'
import { BranchComparisonModal, BranchComparisonModalProps } from '@/components/branch/BranchComparisonModal'

export type GraphComparisonModalProps = BranchComparisonModalProps

/**
 * GraphComparisonModal provides backwards compatibility for existing modal invocations,
 * powered by the interactive Counterfactual Divergence Explorer.
 */
export const GraphComparisonModal: React.FC<GraphComparisonModalProps> = (props) => {
  return <BranchComparisonModal {...props} />
}