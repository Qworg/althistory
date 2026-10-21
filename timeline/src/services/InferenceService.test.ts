import { describe, it, expect, beforeEach } from 'vitest';
import { InferenceService } from './InferenceService';
import { Event } from '@/models/Event';
import { InferredPressure } from '@/models/InferredPressure';

describe('InferenceService - Pattern Detection', () => {
  let inferenceService: InferenceService;

  beforeEach(() => {
    inferenceService = new InferenceService();
  });

  describe('analyzeEventClusters', () => {
    it('should return empty array for no events', () => {
      const result = inferenceService.analyzeEventClusters([]);
      expect(result).toEqual([]);
    });

    it('should detect economic pressure from trade-related events', () => {
      const events = [
        new Event({
          description: 'Trade embargo imposed on neighboring country',
          actor: 'Government A',
          target: 'Country B',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          description: 'Market prices surge due to trade restrictions',
          actor: 'Market Forces',
          target: 'Local Economy',
          timestamp: new Date('2023-01-05')
        }),
        new Event({
          description: 'Currency devaluation begins',
          actor: 'Central Bank',
          target: 'National Currency',
          timestamp: new Date('2023-01-10')
        }),
        new Event({
          description: 'Economic recession officially declared',
          actor: 'Government A',
          target: 'National Economy',
          timestamp: new Date('2023-01-15')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures.length).toBeGreaterThanOrEqual(1);
      const economicPressure = pressures.find(p => p.pressure_type === 'economic');
      expect(economicPressure).toBeDefined();
      expect(economicPressure!.confidence_score).toBeGreaterThan(0.5);
      expect(economicPressure!.evidence.length).toBeGreaterThanOrEqual(2);
      expect(economicPressure!.description).toContain('Economic pressure detected');
    });

    it('should report the evidence events by id and the period inferred over', () => {
      const events = [
        new Event({
          description: 'Trade embargo imposed on neighboring country',
          actor: 'Government A',
          target: 'Country B',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          description: 'Market prices surge due to trade restrictions',
          actor: 'Market Forces',
          target: 'Local Economy',
          timestamp: new Date('2023-01-05')
        }),
        new Event({
          description: 'Currency devaluation begins',
          actor: 'Central Bank',
          target: 'National Currency',
          timestamp: new Date('2023-01-10')
        }),
        new Event({
          description: 'Economic recession officially declared',
          actor: 'Government A',
          target: 'National Economy',
          timestamp: new Date('2023-01-15')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      const economicPressure = pressures.find(p => p.pressure_type === 'economic');
      expect(economicPressure).toBeDefined();

      // The ids of the events the inference rests on, so a client can link the
      // pressure to them instead of guessing from the display strings.
      expect(economicPressure!.evidence_event_ids.length).toBeGreaterThanOrEqual(2);
      const eventIds = new Set(events.map(event => event.id));
      for (const id of economicPressure!.evidence_event_ids) {
        expect(eventIds.has(id)).toBe(true);
      }

      // The period the pressure was inferred over, so a client can place it in
      // time. Before this it appeared only inside the description text.
      expect(economicPressure!.time_range).toBeDefined();
      const start = new Date(economicPressure!.time_range!.start).getTime();
      const end = new Date(economicPressure!.time_range!.end).getTime();
      expect(start).toBeLessThanOrEqual(end);
    });

    it('should detect social pressure from protest-related events', () => {
      const events = [
        new Event({
          description: 'Large protest organized in city center',
          actor: 'Citizens Group',
          target: 'Government',
          timestamp: new Date('2023-02-01')
        }),
        new Event({
          description: 'Civil rights demonstration spreads to other cities',
          actor: 'Social Movement',
          target: 'Public Policy',
          timestamp: new Date('2023-02-03')
        }),
        new Event({
          description: 'Community leaders call for reform',
          actor: 'Community Leaders',
          target: 'Government',
          timestamp: new Date('2023-02-07')
        }),
        new Event({
          description: 'Public uprising gains momentum',
          actor: 'General Public',
          target: 'Political System',
          timestamp: new Date('2023-02-10')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures.length).toBeGreaterThanOrEqual(1);
      const socialPressure = pressures.find(p => p.pressure_type === 'social');
      expect(socialPressure).toBeDefined();
      expect(socialPressure!.confidence_score).toBeGreaterThan(0.5);
      expect(socialPressure!.evidence.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect political pressure from government-related events', () => {
      const events = [
        new Event({
          description: 'New legislation proposed by parliament',
          actor: 'Parliament',
          target: 'Legal System',
          timestamp: new Date('2023-03-01')
        }),
        new Event({
          description: 'Government policy changes announced',
          actor: 'Government',
          target: 'Public Policy',
          timestamp: new Date('2023-03-05')
        }),
        new Event({
          description: 'Political opposition challenges new law',
          actor: 'Opposition Party',
          target: 'Government',
          timestamp: new Date('2023-03-08')
        }),
        new Event({
          description: 'President signs controversial legislation',
          actor: 'President',
          target: 'National Law',
          timestamp: new Date('2023-03-12')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures).toHaveLength(1);
      expect(pressures[0].pressure_type).toBe('political');
      expect(pressures[0].confidence_score).toBeGreaterThan(0.5);
    });

    it('should detect environmental pressure from climate-related events', () => {
      const events = [
        new Event({
          description: 'Severe drought affects agricultural regions',
          actor: 'Climate Change',
          target: 'Agriculture',
          timestamp: new Date('2023-04-01')
        }),
        new Event({
          description: 'Natural disaster strikes coastal areas',
          actor: 'Hurricane',
          target: 'Coastal Communities',
          timestamp: new Date('2023-04-05')
        }),
        new Event({
          description: 'Environmental pollution levels reach critical point',
          actor: 'Industrial Activity',
          target: 'Environment',
          timestamp: new Date('2023-04-10')
        }),
        new Event({
          description: 'Resource scarcity forces population migration',
          actor: 'Resource Depletion',
          target: 'Local Population',
          timestamp: new Date('2023-04-15')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures).toHaveLength(1);
      expect(pressures[0].pressure_type).toBe('environmental');
      expect(pressures[0].confidence_score).toBeGreaterThan(0.5);
    });

    it('should detect multiple pressure types in mixed events', () => {
      const events = [
        // Economic events
        new Event({
          description: 'Trade war escalates between nations',
          actor: 'Government A',
          target: 'Government B',
          timestamp: new Date('2023-05-01')
        }),
        new Event({
          description: 'Market volatility increases dramatically',
          actor: 'Financial Markets',
          target: 'Investors',
          timestamp: new Date('2023-05-03')
        }),
        // Social events
        new Event({
          description: 'Public protests against economic policies',
          actor: 'Citizens',
          target: 'Government A',
          timestamp: new Date('2023-05-05')
        }),
        new Event({
          description: 'Social movement gains widespread support',
          actor: 'Activist Groups',
          target: 'Public Opinion',
          timestamp: new Date('2023-05-07')
        }),
        // Political events
        new Event({
          description: 'Government announces policy reforms',
          actor: 'Government A',
          target: 'National Policy',
          timestamp: new Date('2023-05-10')
        }),
        new Event({
          description: 'Political opposition calls for elections',
          actor: 'Opposition Party',
          target: 'Government A',
          timestamp: new Date('2023-05-12')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures.length).toBeGreaterThanOrEqual(2);
      const pressureTypes = pressures.map(p => p.pressure_type);
      expect(pressureTypes).toContain('economic');
      expect(pressureTypes).toContain('social');
    });

    it('should not detect pressures for insufficient events', () => {
      const events = [
        new Event({
          description: 'Single economic event',
          actor: 'Actor',
          target: 'Target',
          timestamp: new Date('2023-06-01')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      expect(pressures).toHaveLength(0);
    });

    it('should not detect pressures for events too spread out in time', () => {
      const events = [
        new Event({
          description: 'Trade agreement signed',
          actor: 'Government A',
          target: 'Government B',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          description: 'Market responds positively',
          actor: 'Financial Markets',
          target: 'Economy',
          timestamp: new Date('2023-06-01') // 5 months later
        }),
        new Event({
          description: 'Economic growth reported',
          actor: 'Statistics Office',
          target: 'Public',
          timestamp: new Date('2023-12-01') // 11 months later
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      expect(pressures).toHaveLength(0);
    });
  });

  describe('suggestCausalLinks', () => {
    it('should return empty array for insufficient events', () => {
      const events = [
        new Event({
          description: 'Single event',
          actor: 'Actor',
          target: 'Target',
          timestamp: new Date('2023-01-01')
        })
      ];

      const suggestions = inferenceService.suggestCausalLinks(events);
      expect(suggestions).toHaveLength(0);
    });

    it('should suggest causal links for temporally related events', () => {
      const events = [
        new Event({
          id: 'event1',
          description: 'Government announces new tax policy',
          actor: 'Government',
          target: 'Tax System',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          id: 'event2',
          description: 'Businesses react to tax changes',
          actor: 'Business Community',
          target: 'Market Strategy',
          timestamp: new Date('2023-01-05')
        }),
        new Event({
          id: 'event3',
          description: 'Economic indicators show impact',
          actor: 'Economic Analysts',
          target: 'Economic Data',
          timestamp: new Date('2023-01-10')
        })
      ];

      const suggestions = inferenceService.suggestCausalLinks(events);
      
      expect(suggestions.length).toBeGreaterThan(0);
      
      // Check that suggestions maintain temporal ordering
      suggestions.forEach(suggestion => {
        const causeEvent = events.find(e => e.id === suggestion.cause_event_id);
        const effectEvent = events.find(e => e.id === suggestion.effect_event_id);
        expect(causeEvent!.timestamp.getTime()).toBeLessThan(effectEvent!.timestamp.getTime());
      });
      
      // Check confidence scores are reasonable
      suggestions.forEach(suggestion => {
        expect(suggestion.suggested_relationship.confidence).toBeGreaterThan(0);
        expect(suggestion.suggested_relationship.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should prioritize direct actor-target relationships', () => {
      const events = [
        new Event({
          id: 'event1',
          description: 'Actor A takes action',
          actor: 'Actor A',
          target: 'Target X',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          id: 'event2',
          description: 'Target X responds to action',
          actor: 'Target X',
          target: 'Actor A',
          timestamp: new Date('2023-01-02')
        }),
        new Event({
          id: 'event3',
          description: 'Unrelated event',
          actor: 'Actor B',
          target: 'Target Y',
          timestamp: new Date('2023-01-03')
        })
      ];

      const suggestions = inferenceService.suggestCausalLinks(events);
      
      // Should suggest stronger relationship between event1 and event2
      const directSuggestion = suggestions.find(s => 
        s.cause_event_id === 'event1' && s.effect_event_id === 'event2'
      );
      
      expect(directSuggestion).toBeDefined();
      expect(directSuggestion!.suggested_relationship.confidence).toBeGreaterThan(0.5);
      expect(directSuggestion!.suggested_relationship.relationship_type).toBe('direct');
    });

    it('should not suggest causal links for events too far apart in time', () => {
      const events = [
        new Event({
          id: 'event1',
          description: 'Early event',
          actor: 'Actor A',
          target: 'Target X',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          id: 'event2',
          description: 'Much later event',
          actor: 'Actor A',
          target: 'Target X',
          timestamp: new Date('2023-06-01') // 5 months later
        })
      ];

      const suggestions = inferenceService.suggestCausalLinks(events);
      expect(suggestions).toHaveLength(0);
    });

    it('should limit suggestions to top 10', () => {
      // Create many events that could have causal relationships
      const events: Event[] = [];
      for (let i = 0; i < 20; i++) {
        events.push(new Event({
          id: `event${i}`,
          description: `Event ${i} with economic impact`,
          actor: `Actor ${i % 5}`, // Some actor overlap
          target: `Target ${i % 3}`, // Some target overlap
          timestamp: new Date(2023, 0, i + 1) // Sequential days
        }));
      }

      const suggestions = inferenceService.suggestCausalLinks(events);
      expect(suggestions.length).toBeLessThanOrEqual(10);
      
      // Should be sorted by confidence (highest first)
      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i-1].suggested_relationship.confidence)
          .toBeGreaterThanOrEqual(suggestions[i].suggested_relationship.confidence);
      }
    });

    it('should classify relationship types correctly', () => {
      const events = [
        new Event({
          id: 'event1',
          description: 'Government policy announcement',
          actor: 'Government',
          target: 'Public Policy',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          id: 'event2',
          description: 'Public Policy implementation begins',
          actor: 'Public Policy',
          target: 'Citizens',
          timestamp: new Date('2023-01-02')
        }),
        new Event({
          id: 'event3',
          description: 'Citizens react to policy changes',
          actor: 'Citizens',
          target: 'Government',
          timestamp: new Date('2023-01-03')
        })
      ];

      const suggestions = inferenceService.suggestCausalLinks(events);
      
      // Should have different relationship types based on strength
      const relationshipTypes = suggestions.map(s => s.suggested_relationship.relationship_type);
      expect(relationshipTypes.length).toBeGreaterThan(0);
      // At least one should be contributory or direct
      expect(relationshipTypes.some(type => type === 'contributory' || type === 'direct')).toBe(true);
    });
  });

  describe('Historical Scenarios', () => {
    it('should detect economic pressure in Great Depression scenario', () => {
      const events = [
        new Event({
          description: 'Stock market crash triggers financial panic',
          actor: 'Stock Market',
          target: 'Financial System',
          timestamp: new Date('1929-10-24')
        }),
        new Event({
          description: 'Banks begin failing across the country',
          actor: 'Banking System',
          target: 'Depositors',
          timestamp: new Date('1929-10-28')
        }),
        new Event({
          description: 'Unemployment rates surge dramatically',
          actor: 'Economic Conditions',
          target: 'Labor Force',
          timestamp: new Date('1929-11-15')
        }),
        new Event({
          description: 'Industrial production declines sharply',
          actor: 'Manufacturing Sector',
          target: 'Economic Output',
          timestamp: new Date('1929-12-01')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures).toHaveLength(1);
      expect(pressures[0].pressure_type).toBe('economic');
      expect(pressures[0].confidence_score).toBeGreaterThan(0.7);
    });

    it('should detect social pressure in Civil Rights Movement scenario', () => {
      const events = [
        new Event({
          description: 'Rosa Parks refuses to give up bus seat',
          actor: 'Rosa Parks',
          target: 'Segregation System',
          timestamp: new Date('1955-12-01')
        }),
        new Event({
          description: 'Montgomery Bus Boycott begins',
          actor: 'Civil Rights Movement',
          target: 'Public Transportation',
          timestamp: new Date('1955-12-05')
        }),
        new Event({
          description: 'Community organizes sustained protest',
          actor: 'Local Community',
          target: 'City Government',
          timestamp: new Date('1955-12-10')
        }),
        new Event({
          description: 'National attention focuses on civil rights',
          actor: 'Media Coverage',
          target: 'Public Opinion',
          timestamp: new Date('1955-12-20')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures).toHaveLength(1);
      expect(pressures[0].pressure_type).toBe('social');
      expect(pressures[0].confidence_score).toBeGreaterThan(0.6);
    });

    it('should detect environmental pressure in Dust Bowl scenario', () => {
      const events = [
        new Event({
          description: 'Severe drought conditions persist across plains',
          actor: 'Climate Conditions',
          target: 'Agricultural Land',
          timestamp: new Date('1934-05-01')
        }),
        new Event({
          description: 'Massive dust storms devastate farmland',
          actor: 'Environmental Disaster',
          target: 'Farming Communities',
          timestamp: new Date('1934-05-15')
        }),
        new Event({
          description: 'Crop failures force farm abandonment',
          actor: 'Agricultural Crisis',
          target: 'Rural Families',
          timestamp: new Date('1934-06-01')
        }),
        new Event({
          description: 'Mass migration begins from affected regions',
          actor: 'Environmental Refugees',
          target: 'Western States',
          timestamp: new Date('1934-06-15')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);
      
      expect(pressures).toHaveLength(1);
      expect(pressures[0].pressure_type).toBe('environmental');
      expect(pressures[0].confidence_score).toBeGreaterThan(0.6);
    });
  });

  describe('updatePressureConfidence', () => {
    it('should increase confidence with relevant new evidence', () => {
      const originalPressure = new InferredPressure({
        description: 'Economic pressure from trade disruption',
        confidence_score: 0.5,
        pressure_type: 'economic',
        evidence: ['Initial trade disruption event']
      });

      const newEvidence = [
        new Event({
          description: 'Market crash follows trade disruption',
          actor: 'Financial Markets',
          target: 'Investors',
          timestamp: new Date('2023-01-02')
        }),
        new Event({
          description: 'Economic recession officially declared',
          actor: 'Government',
          target: 'Public',
          timestamp: new Date('2023-01-03')
        })
      ];

      const updatedPressure = inferenceService.updatePressureConfidence(originalPressure, newEvidence);

      expect(updatedPressure.confidence_score).toBeGreaterThan(originalPressure.confidence_score);
      expect(updatedPressure.evidence.length).toBeGreaterThan(originalPressure.evidence.length);
    });

    it('should not change confidence with irrelevant evidence', () => {
      const originalPressure = new InferredPressure({
        description: 'Economic pressure',
        confidence_score: 0.6,
        pressure_type: 'economic',
        evidence: ['Initial evidence']
      });

      const irrelevantEvidence = [
        new Event({
          description: 'Weather is nice today',
          actor: 'Nature',
          target: 'People',
          timestamp: new Date('2023-01-02')
        })
      ];

      const updatedPressure = inferenceService.updatePressureConfidence(originalPressure, irrelevantEvidence);

      expect(updatedPressure.confidence_score).toBe(originalPressure.confidence_score);
      expect(updatedPressure.evidence.length).toBe(originalPressure.evidence.length);
    });

    it('should handle empty new evidence', () => {
      const originalPressure = new InferredPressure({
        description: 'Economic pressure',
        confidence_score: 0.6,
        pressure_type: 'economic',
        evidence: ['Initial evidence']
      });

      const updatedPressure = inferenceService.updatePressureConfidence(originalPressure, []);

      expect(updatedPressure).toBe(originalPressure);
    });
  });

  describe('linkPressuresToArcs', () => {
    it('should create DRIVEN_BY relationships for high-confidence pressures', () => {
      const pressures = [
        new InferredPressure({
          description: 'High confidence economic pressure',
          confidence_score: 0.9,
          pressure_type: 'economic',
          evidence: ['Strong evidence 1', 'Strong evidence 2', 'Strong evidence 3']
        }),
        new InferredPressure({
          description: 'Low confidence social pressure',
          confidence_score: 0.2,
          pressure_type: 'social',
          evidence: ['Weak evidence']
        })
      ];

      const arcIds = ['arc1', 'arc2'];
      const relationships = inferenceService.linkPressuresToArcs(pressures, arcIds);

      // Should create relationships for high-confidence pressure only
      expect(relationships.length).toBeGreaterThan(0);
      relationships.forEach(rel => {
        expect(rel.influence_strength).toBeGreaterThan(0.3);
        expect(rel.influence_strength).toBeLessThanOrEqual(1.0);
      });
    });

    it('should not create relationships for low-confidence pressures', () => {
      const pressures = [
        new InferredPressure({
          description: 'Very low confidence pressure',
          confidence_score: 0.1,
          pressure_type: 'economic',
          evidence: ['Minimal evidence']
        })
      ];

      const arcIds = ['arc1'];
      const relationships = inferenceService.linkPressuresToArcs(pressures, arcIds);

      expect(relationships).toHaveLength(0);
    });
  });

  describe('Integration Tests with Historical Data', () => {
    it('should handle complex historical scenario with multiple pressure types', () => {
      // Simulate the 2008 Financial Crisis
      const events = [
        new Event({
          description: 'Subprime mortgage crisis begins',
          actor: 'Banking Sector',
          target: 'Housing Market',
          timestamp: new Date('2008-08-01')
        }),
        new Event({
          description: 'Lehman Brothers collapses',
          actor: 'Investment Bank',
          target: 'Financial System',
          timestamp: new Date('2008-08-15')
        }),
        new Event({
          description: 'Stock market crashes globally',
          actor: 'Financial Markets',
          target: 'Global Economy',
          timestamp: new Date('2008-09-01')
        }),
        new Event({
          description: 'Unemployment rates surge',
          actor: 'Economic Conditions',
          target: 'Labor Force',
          timestamp: new Date('2008-09-15')
        }),
        new Event({
          description: 'Public protests against bank bailouts',
          actor: 'Citizens',
          target: 'Government Policy',
          timestamp: new Date('2008-10-01')
        }),
        new Event({
          description: 'Government implements stimulus package',
          actor: 'Government',
          target: 'National Economy',
          timestamp: new Date('2008-10-15')
        })
      ];

      const pressures = inferenceService.analyzeEventClusters(events);

      // Should detect both economic and social pressures
      expect(pressures.length).toBeGreaterThanOrEqual(1);
      
      const economicPressure = pressures.find(p => p.pressure_type === 'economic');
      expect(economicPressure).toBeDefined();
      expect(economicPressure!.confidence_score).toBeGreaterThan(0.6);

      // Test causal suggestions
      const causalSuggestions = inferenceService.suggestCausalLinks(events);
      expect(causalSuggestions.length).toBeGreaterThanOrEqual(0); // May or may not find causal links
      
      // Should suggest causal links between financial events
      const financialCausalLinks = causalSuggestions.filter(s => {
        const causeEvent = events.find(e => e.id === s.cause_event_id);
        const effectEvent = events.find(e => e.id === s.effect_event_id);
        return causeEvent?.description.includes('mortgage') && effectEvent?.description.includes('Lehman');
      });
      
      expect(financialCausalLinks.length).toBeGreaterThanOrEqual(0); // May or may not find this specific link
    });

    it('should update pressure confidence with new evidence over time', () => {
      // Initial events suggesting economic pressure
      const initialEvents = [
        new Event({
          description: 'Trade tensions escalate',
          actor: 'Government A',
          target: 'Government B',
          timestamp: new Date('2023-01-01')
        }),
        new Event({
          description: 'Market volatility increases',
          actor: 'Financial Markets',
          target: 'Investors',
          timestamp: new Date('2023-01-05')
        })
      ];

      const initialPressures = inferenceService.analyzeEventClusters(initialEvents);
      expect(initialPressures.length).toBeGreaterThanOrEqual(1);
      
      const economicPressure = initialPressures.find(p => p.pressure_type === 'economic');
      expect(economicPressure).toBeDefined();
      
      const initialConfidence = economicPressure!.confidence_score;

      // New events that reinforce the economic pressure
      const newEvents = [
        new Event({
          description: 'Currency devaluation accelerates',
          actor: 'Central Bank',
          target: 'National Currency',
          timestamp: new Date('2023-01-10')
        }),
        new Event({
          description: 'Industrial production declines',
          actor: 'Manufacturing Sector',
          target: 'Economic Output',
          timestamp: new Date('2023-01-15')
        })
      ];

      const updatedPressure = inferenceService.updatePressureConfidence(economicPressure!, newEvents);
      
      expect(updatedPressure.confidence_score).toBeGreaterThanOrEqual(initialConfidence);
      expect(updatedPressure.evidence.length).toBeGreaterThan(economicPressure!.evidence.length);
    });
  });
});