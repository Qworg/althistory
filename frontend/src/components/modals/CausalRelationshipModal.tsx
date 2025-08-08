import React, { useState, useEffect } from 'react'
import { CausalRelationship, Event, CausalRelationshipData } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'

export interface CausalRelationshipModalProps {
  relationship: CausalRelationship | null
  isOpen: boolean
  onClose: () => void
  onSave?: (relationship: CausalRelationship) => void
  onDelete?: (relationshipId: string) => void
}

export const CausalRelationshipModal: React.FC<CausalRelationshipModalProps> = ({
  relationship,
  isOpen,
  onClose,
  onSave,
  onDelete
}) => {
  const [formData, setFormData] = useState<CausalRelationshipData>({
    weight: 0.5,
    evidence: '',
    confidence: 0.7,
    relationship_type: 'direct'
  })
  const [isLoading, setIsLoading] = useState(false)
  const [causeEvent, setCauseEvent] = useState<Event | null>(null)
  const [effectEvent, setEffectEvent] = useState<Event | null>(null)

  const { 
    events, 
    updateCausalRelationship, 
    deleteCausalRelationship, 
    addError 
  } = useGlobalStore()

  // Load relationship data when modal opens
  useEffect(() => {
    if (relationship && isOpen) {
      setFormData({
        weight: relationship.weight,
        evidence: relationship.evidence,
        confidence: relationship.confidence,
        relationship_type: relationship.relationship_type
      })

      // Find cause and effect events
      const cause = events.find(e => e.id === relationship.cause_event_id)
      const effect = events.find(e => e.id === relationship.effect_event_id)
      setCauseEvent(cause || null)
      setEffectEvent(effect || null)
    }
  }, [relationship, isOpen, events])

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        weight: 0.5,
        evidence: '',
        confidence: 0.7,
        relationship_type: 'direct'
      })
      setCauseEvent(null)
      setEffectEvent(null)
    }
  }, [isOpen])

  const handleSave = async () => {
    if (!relationship) return

    try {
      setIsLoading(true)

      // Validate form data
      if (formData.weight < 0 || formData.weight > 1) {
        addError({
          message: 'Weight must be between 0 and 1',
          type: 'validation'
        })
        return
      }

      if (formData.confidence < 0 || formData.confidence > 1) {
        addError({
          message: 'Confidence must be between 0 and 1',
          type: 'validation'
        })
        return
      }

      // Update via API
      const updatedRelationship = await apiClient.causal.updateLink(relationship.id, formData)
      
      // Update global state
      updateCausalRelationship(relationship.id, formData)
      
      // Notify parent
      onSave?.(updatedRelationship)
      
      onClose()
    } catch (error) {
      console.error('Failed to update causal relationship:', error)
      addError({
        message: 'Failed to update causal relationship',
        type: 'network'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!relationship) return

    if (!confirm('Are you sure you want to delete this causal relationship?')) {
      return
    }

    try {
      setIsLoading(true)

      // Delete via API
      await apiClient.causal.deleteLink(relationship.id)
      
      // Update global state
      deleteCausalRelationship(relationship.id)
      
      // Notify parent
      onDelete?.(relationship.id)
      
      onClose()
    } catch (error) {
      console.error('Failed to delete causal relationship:', error)
      addError({
        message: 'Failed to delete causal relationship',
        type: 'network'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: keyof CausalRelationshipData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  if (!isOpen || !relationship) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Edit Causal Relationship
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Event Information */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Relationship</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-white rounded px-3 py-2 border">
                  <div className="text-sm font-medium text-gray-900">
                    {causeEvent ? `${causeEvent.actor} → ${causeEvent.target}` : 'Unknown Event'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {causeEvent ? new Date(causeEvent.timestamp).toLocaleString() : 'N/A'}
                  </div>
                </div>
                <div className="text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
                <div className="flex-1 bg-white rounded px-3 py-2 border">
                  <div className="text-sm font-medium text-gray-900">
                    {effectEvent ? `${effectEvent.actor} → ${effectEvent.target}` : 'Unknown Event'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {effectEvent ? new Date(effectEvent.timestamp).toLocaleString() : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Weight */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Weight ({formData.weight.toFixed(2)})
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={formData.weight}
                onChange={(e) => handleInputChange('weight', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                disabled={isLoading}
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Weak (0.0)</span>
                <span>Strong (1.0)</span>
              </div>
            </div>

            {/* Confidence */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Confidence ({formData.confidence.toFixed(2)})
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={formData.confidence}
                onChange={(e) => handleInputChange('confidence', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                disabled={isLoading}
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Low (0.0)</span>
                <span>High (1.0)</span>
              </div>
            </div>

            {/* Relationship Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Relationship Type
              </label>
              <select
                value={formData.relationship_type}
                onChange={(e) => handleInputChange('relationship_type', e.target.value as CausalRelationshipData['relationship_type'])}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              >
                <option value="direct">Direct</option>
                <option value="indirect">Indirect</option>
                <option value="contributory">Contributory</option>
              </select>
            </div>

            {/* Evidence */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Evidence
              </label>
              <textarea
                value={formData.evidence}
                onChange={(e) => handleInputChange('evidence', e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Describe the evidence supporting this causal relationship..."
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200">
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
            disabled={isLoading}
          >
            Delete Relationship
          </button>
          
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CausalRelationshipModal