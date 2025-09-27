import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeSynthesizer } from '../../src/multi-agent/knowledge-synthesis';
import { ConflictResolver } from '../../src/multi-agent/conflict-resolver';
import {
  Knowledge,
  AgentContribution,
  Conflict,
  ResolutionStrategy,
  KnowledgeSynthesis,
  ConflictProposal
} from '../../src/multi-agent/types';

describe('KnowledgeSynthesizer', () => {
  let synthesizer: KnowledgeSynthesizer;

  beforeEach(() => {
    synthesizer = new KnowledgeSynthesizer();
  });

  describe('Knowledge Merging', () => {
    it('should merge compatible knowledge', async () => {
      const k1: Knowledge = {
        id: 'k1',
        type: 'technical',
        content: { recommendation: 'Use async/await', reason: 'Readability' },
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.8,
          verifiedBy: ['claude-1'],
          tags: ['async', 'best-practice']
        },
        version: 1,
        contributors: ['claude-1']
      };

      const k2: Knowledge = {
        id: 'k2',
        type: 'technical',
        content: { recommendation: 'Use async/await', reason: 'Error handling' },
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.85,
          verifiedBy: ['claude-2'],
          tags: ['async', 'error-handling']
        },
        version: 1,
        contributors: ['claude-2']
      };

      const merged = await synthesizer.mergeKnowledge([k1, k2]);

      expect(merged.contributors).toContain('claude-1');
      expect(merged.contributors).toContain('claude-2');
      expect(merged.metadata.quality).toBeGreaterThan(0.8);
      expect(merged.metadata.tags).toContain('async');
      expect(merged.metadata.tags).toContain('best-practice');
      expect(merged.metadata.tags).toContain('error-handling');
    });

    it('should detect incompatible knowledge', async () => {
      const k1: Knowledge = {
        id: 'k1',
        type: 'architecture',
        content: { database: 'MongoDB', reason: 'Flexibility' },
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.7,
          verifiedBy: [],
          tags: ['nosql']
        },
        version: 1,
        contributors: ['claude-1']
      };

      const k2: Knowledge = {
        id: 'k2',
        type: 'architecture',
        content: { database: 'PostgreSQL', reason: 'ACID compliance' },
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.8,
          verifiedBy: [],
          tags: ['sql']
        },
        version: 1,
        contributors: ['claude-2']
      };

      const result = await synthesizer.detectIncompatibilities([k1, k2]);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe('data');
    });

    it('should synthesize from contributions', async () => {
      const contributions: AgentContribution[] = [
        {
          agentId: 'claude-1',
          contribution: 'Implement caching for performance',
          timestamp: new Date(),
          confidence: 0.8,
          evidence: ['Reduced latency by 50%']
        },
        {
          agentId: 'claude-2',
          contribution: 'Use Redis for distributed caching',
          timestamp: new Date(),
          confidence: 0.9,
          evidence: ['Scales horizontally', 'Production tested']
        },
        {
          agentId: 'claude-3',
          contribution: 'Set TTL to prevent stale data',
          timestamp: new Date(),
          confidence: 0.85,
          evidence: ['Prevents memory leaks']
        }
      ];

      const synthesis = await synthesizer.synthesize(contributions);

      expect(synthesis.synthesizedKnowledge.type).toBe('synthesized');
      expect(synthesis.confidence).toBeGreaterThan(0.8);
      expect(synthesis.synthesizedKnowledge.contributors).toHaveLength(3);
    });

    it('should rank knowledge by quality', async () => {
      const knowledgeItems: Knowledge[] = [
        {
          id: 'low',
          type: 'pattern',
          content: 'Low quality pattern',
          metadata: {
            created: new Date(),
            updated: new Date(),
            quality: 0.3,
            verifiedBy: [],
            tags: []
          },
          version: 1,
          contributors: ['claude-1']
        },
        {
          id: 'high',
          type: 'pattern',
          content: 'High quality pattern',
          metadata: {
            created: new Date(),
            updated: new Date(),
            quality: 0.95,
            verifiedBy: ['claude-1', 'claude-2', 'claude-3'],
            tags: ['verified', 'production']
          },
          version: 1,
          contributors: ['claude-1', 'claude-2']
        },
        {
          id: 'medium',
          type: 'pattern',
          content: 'Medium quality pattern',
          metadata: {
            created: new Date(),
            updated: new Date(),
            quality: 0.6,
            verifiedBy: ['claude-1'],
            tags: []
          },
          version: 1,
          contributors: ['claude-1']
        }
      ];

      const ranked = await synthesizer.rankByQuality(knowledgeItems);

      expect(ranked[0].id).toBe('high');
      expect(ranked[1].id).toBe('medium');
      expect(ranked[2].id).toBe('low');
    });
  });

  describe('Knowledge Verification', () => {
    it('should verify knowledge with multiple agents', async () => {
      const knowledge: Knowledge = {
        id: 'k1',
        type: 'solution',
        content: { solution: 'Use connection pooling' },
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.5,
          verifiedBy: [],
          tags: []
        },
        version: 1,
        contributors: ['claude-1']
      };

      const verifications = [
        { agentId: 'claude-2', verified: true, confidence: 0.9 },
        { agentId: 'claude-3', verified: true, confidence: 0.85 },
        { agentId: 'claude-4', verified: false, confidence: 0.3 }
      ];

      const verified = await synthesizer.verifyKnowledge(knowledge, verifications);

      expect(verified.metadata.verifiedBy).toContain('claude-2');
      expect(verified.metadata.verifiedBy).toContain('claude-3');
      expect(verified.metadata.quality).toBeGreaterThan(0.5);
    });

    it('should calculate consensus level', async () => {
      const agreements = [
        { agentId: 'claude-1', agrees: true },
        { agentId: 'claude-2', agrees: true },
        { agentId: 'claude-3', agrees: false },
        { agentId: 'claude-4', agrees: true }
      ];

      const consensus = await synthesizer.calculateConsensus(agreements);

      expect(consensus.level).toBe(0.75); // 3 out of 4 agree
      expect(consensus.majority).toBe(true);
      expect(consensus.dissenting).toContain('claude-3');
    });
  });

  describe('Knowledge Evolution', () => {
    it('should track knowledge evolution', async () => {
      const originalKnowledge: Knowledge = {
        id: 'k1',
        type: 'pattern',
        content: { pattern: 'Initial pattern' },
        metadata: {
          created: new Date(Date.now() - 86400000),
          updated: new Date(Date.now() - 86400000),
          quality: 0.6,
          verifiedBy: ['claude-1'],
          tags: ['initial']
        },
        version: 1,
        contributors: ['claude-1']
      };

      const updates = [
        { agentId: 'claude-2', update: 'Refined pattern', timestamp: new Date() },
        { agentId: 'claude-3', update: 'Added edge cases', timestamp: new Date() }
      ];

      const evolved = await synthesizer.evolveKnowledge(originalKnowledge, updates);

      expect(evolved.version).toBe(3); // Original + 2 updates
      expect(evolved.contributors).toContain('claude-2');
      expect(evolved.contributors).toContain('claude-3');
      expect(evolved.metadata.updated.getTime()).toBeGreaterThan(
        originalKnowledge.metadata.updated.getTime()
      );
    });

    it('should maintain version history', async () => {
      const knowledge: Knowledge = {
        id: 'k1',
        type: 'technical',
        content: 'Version 1',
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.7,
          verifiedBy: [],
          tags: []
        },
        version: 1,
        contributors: ['claude-1']
      };

      await synthesizer.addKnowledge(knowledge);

      // Update multiple times
      await synthesizer.updateKnowledge('k1', {
        content: 'Version 2',
        updatedBy: 'claude-2'
      });

      await synthesizer.updateKnowledge('k1', {
        content: 'Version 3',
        updatedBy: 'claude-3'
      });

      const history = await synthesizer.getVersionHistory('k1');

      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(1);
      expect(history[2].version).toBe(3);
    });
  });

  describe('Knowledge Search', () => {
    beforeEach(async () => {
      // Add test knowledge
      await synthesizer.addKnowledge({
        id: 'k1',
        type: 'pattern',
        content: 'Database optimization pattern',
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.8,
          verifiedBy: [],
          tags: ['database', 'optimization']
        },
        version: 1,
        contributors: ['claude-1']
      });

      await synthesizer.addKnowledge({
        id: 'k2',
        type: 'solution',
        content: 'Caching solution for database',
        metadata: {
          created: new Date(),
          updated: new Date(),
          quality: 0.9,
          verifiedBy: [],
          tags: ['caching', 'database']
        },
        version: 1,
        contributors: ['claude-2']
      });
    });

    it('should search knowledge by tags', async () => {
      const results = await synthesizer.searchByTags(['database']);
      expect(results).toHaveLength(2);
    });

    it('should search knowledge by type', async () => {
      const patterns = await synthesizer.searchByType('pattern');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].id).toBe('k1');
    });

    it('should search knowledge by contributors', async () => {
      const byContributor = await synthesizer.searchByContributor('claude-1');
      expect(byContributor).toHaveLength(1);
      expect(byContributor[0].id).toBe('k1');
    });
  });
});

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('Conflict Detection', () => {
    it('should detect data conflicts', async () => {
      const proposals = [
        { agent: 'claude-1', value: 'MongoDB', type: 'database' },
        { agent: 'claude-2', value: 'PostgreSQL', type: 'database' }
      ];

      const conflict = await resolver.detectConflict(proposals);
      expect(conflict).toBeDefined();
      expect(conflict?.type).toBe('data');
      expect(conflict?.parties).toContain('claude-1');
      expect(conflict?.parties).toContain('claude-2');
    });

    it('should detect priority conflicts', async () => {
      const tasks = [
        { agent: 'claude-1', taskId: 't1', priority: 1 },
        { agent: 'claude-2', taskId: 't1', priority: 3 }
      ];

      const conflict = await resolver.detectPriorityConflict(tasks);
      expect(conflict).toBeDefined();
      expect(conflict?.type).toBe('priority');
    });

    it('should not detect conflict when values agree', async () => {
      const proposals = [
        { agent: 'claude-1', value: 'Redis', type: 'cache' },
        { agent: 'claude-2', value: 'Redis', type: 'cache' }
      ];

      const conflict = await resolver.detectConflict(proposals);
      expect(conflict).toBeNull();
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve by voting', async () => {
      const conflict: Conflict = {
        id: 'c1',
        type: 'decision',
        description: 'Database choice',
        parties: ['claude-1', 'claude-2', 'claude-3'],
        proposals: [
          {
            proposedBy: 'claude-1',
            solution: 'MongoDB',
            rationale: 'Flexibility',
            support: ['claude-3'],
            opposition: ['claude-2']
          },
          {
            proposedBy: 'claude-2',
            solution: 'PostgreSQL',
            rationale: 'ACID',
            support: ['claude-2'],
            opposition: ['claude-1', 'claude-3']
          }
        ],
        status: 'open'
      };

      const resolution = await resolver.resolveByVoting(conflict);
      expect(resolution.type).toBe('voting');
      expect(resolution.result).toBe('MongoDB'); // Has more support
    });

    it('should resolve by expertise', async () => {
      const conflict: Conflict = {
        id: 'c2',
        type: 'technical',
        description: 'Algorithm choice',
        parties: ['claude-1', 'claude-2'],
        proposals: [
          {
            proposedBy: 'claude-1',
            solution: 'QuickSort',
            rationale: 'General purpose',
            support: [],
            opposition: []
          },
          {
            proposedBy: 'claude-2',
            solution: 'MergeSort',
            rationale: 'Stable sort needed',
            support: [],
            opposition: []
          }
        ],
        status: 'open'
      };

      const expertise = new Map([
        ['claude-1', { domain: 'general', level: 0.7 }],
        ['claude-2', { domain: 'algorithms', level: 0.9 }]
      ]);

      const resolution = await resolver.resolveByExpertise(conflict, expertise);
      expect(resolution.type).toBe('expertise');
      expect(resolution.result).toBe('MergeSort'); // claude-2 has higher expertise
    });

    it('should resolve by consensus', async () => {
      const conflict: Conflict = {
        id: 'c3',
        type: 'approach',
        description: 'Architecture style',
        parties: ['claude-1', 'claude-2', 'claude-3'],
        proposals: [
          {
            proposedBy: 'claude-1',
            solution: 'Microservices',
            rationale: 'Scalability',
            support: [],
            opposition: []
          },
          {
            proposedBy: 'claude-2',
            solution: 'Modular monolith',
            rationale: 'Simplicity first',
            support: [],
            opposition: []
          }
        ],
        status: 'open'
      };

      const resolution = await resolver.buildConsensus(conflict, {
        method: 'discussion',
        rounds: 3,
        threshold: 0.67
      });

      expect(resolution.type).toBe('consensus');
      expect(resolution.result).toBeDefined();
    });

    it('should resolve by compromise', async () => {
      const conflict: Conflict = {
        id: 'c4',
        type: 'decision',
        description: 'Cache duration',
        parties: ['claude-1', 'claude-2'],
        proposals: [
          {
            proposedBy: 'claude-1',
            solution: '5 minutes',
            rationale: 'Fresh data',
            support: [],
            opposition: []
          },
          {
            proposedBy: 'claude-2',
            solution: '60 minutes',
            rationale: 'Performance',
            support: [],
            opposition: []
          }
        ],
        status: 'open'
      };

      const resolution = await resolver.resolveByCompromise(conflict);
      expect(resolution.type).toBe('compromise');
      expect(resolution.result).toContain('minute'); // Should be between 5 and 60
    });
  });

  describe('Resolution History', () => {
    it('should track resolution history', async () => {
      const conflict: Conflict = {
        id: 'c5',
        type: 'decision',
        description: 'Test conflict',
        parties: ['claude-1', 'claude-2'],
        proposals: [],
        status: 'open'
      };

      const strategy: ResolutionStrategy = {
        type: 'voting',
        description: 'Resolved by majority vote',
        result: 'Option A',
        implementedBy: 'claude-1',
        timestamp: new Date()
      };

      await resolver.recordResolution(conflict.id, strategy);
      const history = await resolver.getResolutionHistory(conflict.id);

      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('voting');
    });

    it('should analyze resolution effectiveness', async () => {
      // Add multiple resolutions
      await resolver.recordResolution('c1', {
        type: 'voting',
        description: 'Vote resolution',
        result: 'A',
        implementedBy: 'claude-1',
        timestamp: new Date()
      });

      await resolver.recordResolution('c2', {
        type: 'voting',
        description: 'Another vote',
        result: 'B',
        implementedBy: 'claude-2',
        timestamp: new Date()
      });

      await resolver.recordResolution('c3', {
        type: 'expertise',
        description: 'Expert decision',
        result: 'C',
        implementedBy: 'claude-3',
        timestamp: new Date()
      });

      const analysis = await resolver.analyzeResolutionMethods();

      expect(analysis.mostUsed).toBe('voting');
      expect(analysis.methodCounts.get('voting')).toBe(2);
      expect(analysis.methodCounts.get('expertise')).toBe(1);
    });
  });

  describe('Escalation', () => {
    it('should escalate unresolved conflicts', async () => {
      const conflict: Conflict = {
        id: 'c6',
        type: 'critical',
        description: 'Critical decision deadlock',
        parties: ['claude-1', 'claude-2'],
        proposals: [],
        status: 'open'
      };

      const escalated = await resolver.escalate(conflict, {
        reason: 'Deadlock after 3 attempts',
        escalateTo: 'human-review',
        priority: 'high'
      });

      expect(escalated.status).toBe('escalated');
      expect(escalated.escalation).toBeDefined();
      expect(escalated.escalation?.priority).toBe('high');
    });

    it('should notify on escalation', async () => {
      const notificationSpy = vi.fn();
      resolver.onEscalation(notificationSpy);

      const conflict: Conflict = {
        id: 'c7',
        type: 'critical',
        description: 'Test conflict',
        parties: ['claude-1'],
        proposals: [],
        status: 'open'
      };

      await resolver.escalate(conflict, {
        reason: 'Test',
        escalateTo: 'admin'
      });

      expect(notificationSpy).toHaveBeenCalledWith(
        expect.objectContaining({ conflictId: 'c7' })
      );
    });
  });
});