import { v4 as uuid } from 'uuid';
import {
  Knowledge,
  AgentContribution,
  KnowledgeSynthesis,
  Conflict,
  KnowledgeMetadata
} from './types.js';

interface IncompatibilityResult {
  hasConflicts: boolean;
  conflicts: Conflict[];
}

interface ConsensusResult {
  level: number;
  majority: boolean;
  dissenting: string[];
}

interface VerificationInput {
  agentId: string;
  verified: boolean;
  confidence: number;
}

interface AgreementInput {
  agentId: string;
  agrees: boolean;
}

interface KnowledgeUpdate {
  agentId: string;
  update: string;
  timestamp: Date;
}

interface KnowledgeVersion {
  version: number;
  content: any;
  timestamp: Date;
  contributor: string;
}

export class KnowledgeSynthesizer {
  private knowledgeBase: Map<string, Knowledge> = new Map();
  private versionHistory: Map<string, KnowledgeVersion[]> = new Map();

  async mergeKnowledge(knowledgeItems: Knowledge[]): Promise<Knowledge> {
    if (knowledgeItems.length === 0) {
      throw new Error('No knowledge items to merge');
    }

    // Collect all contributors
    const contributors = new Set<string>();
    const tags = new Set<string>();
    const verifiedBy = new Set<string>();
    let totalQuality = 0;

    for (const item of knowledgeItems) {
      item.contributors.forEach(c => contributors.add(c));
      item.metadata.tags.forEach(t => tags.add(t));
      item.metadata.verifiedBy.forEach(v => verifiedBy.add(v));
      totalQuality += item.metadata.quality;
    }

    // Merge content
    const mergedContent = this.mergeContent(knowledgeItems.map(k => k.content));

    const merged: Knowledge = {
      id: uuid(),
      type: knowledgeItems[0].type,
      content: mergedContent,
      metadata: {
        created: new Date(),
        updated: new Date(),
        quality: Math.min(1, (totalQuality / knowledgeItems.length) * 1.1), // Boost for consensus
        verifiedBy: Array.from(verifiedBy),
        tags: Array.from(tags)
      },
      version: 1,
      contributors: Array.from(contributors)
    };

    return merged;
  }

  private mergeContent(contents: any[]): any {
    // Simple merge strategy - combine all content
    if (typeof contents[0] === 'object') {
      const merged: any = {};
      for (const content of contents) {
        Object.assign(merged, content);
      }
      return merged;
    }

    return contents.join('. ');
  }

  async detectIncompatibilities(knowledgeItems: Knowledge[]): Promise<IncompatibilityResult> {
    const conflicts: Conflict[] = [];

    for (let i = 0; i < knowledgeItems.length; i++) {
      for (let j = i + 1; j < knowledgeItems.length; j++) {
        const conflict = this.checkIncompatibility(knowledgeItems[i], knowledgeItems[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts
    };
  }

  private checkIncompatibility(k1: Knowledge, k2: Knowledge): Conflict | null {
    // Check for conflicting database choices
    const content1 = JSON.stringify(k1.content).toLowerCase();
    const content2 = JSON.stringify(k2.content).toLowerCase();

    const conflictingPairs = [
      ['mongodb', 'postgresql'],
      ['redis', 'memcached'],
      ['rest', 'graphql']
    ];

    for (const [term1, term2] of conflictingPairs) {
      if (
        (content1.includes(term1) && content2.includes(term2)) ||
        (content1.includes(term2) && content2.includes(term1))
      ) {
        return {
          id: uuid(),
          type: 'data',
          description: `Conflict between ${term1} and ${term2}`,
          parties: [...k1.contributors, ...k2.contributors],
          proposals: [],
          status: 'open'
        };
      }
    }

    return null;
  }

  async synthesize(contributions: AgentContribution[]): Promise<KnowledgeSynthesis> {
    const combinedContent: string[] = [];
    const allEvidence: string[] = [];
    const contributors: string[] = [];
    let totalConfidence = 0;

    for (const contrib of contributions) {
      combinedContent.push(contrib.contribution);
      allEvidence.push(...contrib.evidence);
      contributors.push(contrib.agentId);
      totalConfidence += contrib.confidence;
    }

    const synthesized: Knowledge = {
      id: uuid(),
      type: 'synthesized',
      content: combinedContent.join('. '),
      metadata: {
        created: new Date(),
        updated: new Date(),
        quality: totalConfidence / contributions.length,
        verifiedBy: [],
        tags: ['synthesized']
      },
      version: 1,
      contributors
    };

    return {
      sources: contributions,
      synthesizedKnowledge: synthesized,
      confidence: totalConfidence / contributions.length
    };
  }

  async rankByQuality(knowledgeItems: Knowledge[]): Promise<Knowledge[]> {
    return knowledgeItems.sort((a, b) => {
      // Primary sort by quality
      const qualityDiff = b.metadata.quality - a.metadata.quality;
      if (qualityDiff !== 0) return qualityDiff;

      // Secondary sort by verification count
      return b.metadata.verifiedBy.length - a.metadata.verifiedBy.length;
    });
  }

  async verifyKnowledge(
    knowledge: Knowledge,
    verifications: VerificationInput[]
  ): Promise<Knowledge> {
    const verified = { ...knowledge };
    const verifiers = new Set(verified.metadata.verifiedBy);

    let totalConfidence = verified.metadata.quality;
    let verificationCount = 0;

    for (const verification of verifications) {
      if (verification.verified && verification.confidence > 0.5) {
        verifiers.add(verification.agentId);
        totalConfidence += verification.confidence;
        verificationCount++;
      }
    }

    verified.metadata.verifiedBy = Array.from(verifiers);
    if (verificationCount > 0) {
      verified.metadata.quality = Math.min(1, totalConfidence / (verificationCount + 1));
    }

    return verified;
  }

  async calculateConsensus(agreements: AgreementInput[]): Promise<ConsensusResult> {
    const agreeing = agreements.filter(a => a.agrees);
    const dissenting = agreements.filter(a => !a.agrees).map(a => a.agentId);

    const level = agreeing.length / agreements.length;
    const majority = level > 0.5;

    return {
      level,
      majority,
      dissenting
    };
  }

  async evolveKnowledge(
    original: Knowledge,
    updates: KnowledgeUpdate[]
  ): Promise<Knowledge> {
    const evolved = { ...original };
    const contributors = new Set(evolved.contributors);

    for (const update of updates) {
      contributors.add(update.agentId);
      evolved.version++;
      evolved.metadata.updated = update.timestamp;

      // Add version to history
      const history = this.versionHistory.get(original.id) || [];
      history.push({
        version: evolved.version,
        content: update.update,
        timestamp: update.timestamp,
        contributor: update.agentId
      });
      this.versionHistory.set(original.id, history);
    }

    evolved.contributors = Array.from(contributors);
    return evolved;
  }

  async addKnowledge(knowledge: Knowledge): Promise<void> {
    this.knowledgeBase.set(knowledge.id, knowledge);

    // Initialize version history
    const history: KnowledgeVersion[] = [{
      version: knowledge.version,
      content: knowledge.content,
      timestamp: knowledge.metadata.created,
      contributor: knowledge.contributors[0] || 'unknown'
    }];
    this.versionHistory.set(knowledge.id, history);
  }

  async updateKnowledge(id: string, update: { content: any; updatedBy: string }): Promise<void> {
    const knowledge = this.knowledgeBase.get(id);
    if (!knowledge) {
      throw new Error('Knowledge not found');
    }

    knowledge.content = update.content;
    knowledge.version++;
    knowledge.metadata.updated = new Date();
    if (!knowledge.contributors.includes(update.updatedBy)) {
      knowledge.contributors.push(update.updatedBy);
    }

    // Add to version history
    const history = this.versionHistory.get(id) || [];
    history.push({
      version: knowledge.version,
      content: update.content,
      timestamp: new Date(),
      contributor: update.updatedBy
    });
    this.versionHistory.set(id, history);
  }

  async getVersionHistory(id: string): Promise<KnowledgeVersion[]> {
    return this.versionHistory.get(id) || [];
  }

  async searchByTags(tags: string[]): Promise<Knowledge[]> {
    const results: Knowledge[] = [];

    for (const knowledge of this.knowledgeBase.values()) {
      const hasTag = tags.some(tag => knowledge.metadata.tags.includes(tag));
      if (hasTag) {
        results.push(knowledge);
      }
    }

    return results;
  }

  async searchByType(type: string): Promise<Knowledge[]> {
    return Array.from(this.knowledgeBase.values()).filter(k => k.type === type);
  }

  async searchByContributor(contributorId: string): Promise<Knowledge[]> {
    return Array.from(this.knowledgeBase.values()).filter(
      k => k.contributors.includes(contributorId)
    );
  }
}