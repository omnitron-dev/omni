export interface AgentIdentity {
  id: string;
  model: string;
  specialization?: string[];
  capabilities: AgentCapability[];
  preferences: AgentPreferences;
  reputation: ReputationScore;
  sessionHistory: SessionInfo[];
}

export interface AgentCapability {
  tool: string;
  proficiency: number;
  successRate: number;
  avgExecutionTime: number;
}

export interface AgentPreferences {
  maxConcurrentTasks: number;
  preferredTaskTypes: string[];
  contextWindowSize: number;
}

export interface ReputationScore {
  score: number;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
}

export interface SessionInfo {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  tasksCompleted: number;
  errors: number;
  performance: SessionMetrics;
}

export interface AgentSession {
  agentId: string;
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  tasksCompleted: string[];
  knowledgeGenerated: string[];
  errors: ErrorInfo[];
  performance: SessionMetrics;
}

export interface SessionMetrics {
  duration?: number;
  tasksCompleted: number;
  errors: number;
  successRate: number;
  avgTaskTime?: number;
  memoryUsage?: number;
  toolCalls?: number;
}

export interface ErrorInfo {
  message: string;
  timestamp: Date;
  context: any;
  stack?: string;
  recovery?: string;
}

export interface AgentHandoff {
  fromAgent: string;
  toAgent: string;
  task: string;
  context: HandoffContext;
  reason: string;
  continuationInstructions?: string;
  timestamp?: Date;
}

export interface HandoffContext {
  currentProgress: number;
  completedSteps: string[];
  remainingWork: string[];
  sharedKnowledge: Record<string, any>;
  warnings: string[];
  dependencies?: string[];
  blockers?: string[];
}

export interface TaskRequirements {
  requiredSpecialization?: string[];
  requiredTools?: string[];
  preferredReputation?: number;
  estimatedDuration?: number;
  complexity?: 'low' | 'medium' | 'high';
}

export interface SharedMemory {
  insights: Map<string, Insight>;
  patterns: Map<string, Pattern>;
  solutions: Map<string, Solution>;
  activeContexts: Map<string, WorkingContext>;
  pendingDecisions: DecisionRequest[];
  completedTasks: Map<string, TaskCompletion>;
  learnedPatterns: Pattern[];
  errorDatabase: ErrorPattern[];
}

export interface WorkingContext {
  agentId: string;
  taskId: string;
  relevantNodes: string[];
  activeFiles: string[];
  decisions: Decision[];
  assumptions: Assumption[];
  constraints: Constraint[];
}

export interface Insight {
  id: string;
  type: 'optimization' | 'bug' | 'pattern' | 'improvement';
  description: string;
  evidence: string[];
  confidence: number;
  timestamp: Date;
  contributor: string;
}

export interface Pattern {
  id: string;
  type: 'success' | 'failure' | 'optimization' | 'workflow';
  description: string;
  occurrences: number;
  context: string[];
  impact: number;
  recommendations: string[];
}

export interface Solution {
  id: string;
  problemId: string;
  description: string;
  implementation: string;
  effectiveness: number;
  usedBy: string[];
  timestamp: Date;
}

export interface DecisionRequest {
  id: string;
  type: string;
  description: string;
  options: DecisionOption[];
  requestedBy: string;
  timestamp: Date;
  deadline?: Date;
}

export interface DecisionOption {
  id: string;
  description: string;
  pros: string[];
  cons: string[];
  confidence: number;
  votes?: Map<string, boolean>;
}

export interface Decision {
  id: string;
  type: string;
  description: string;
  rationale: string;
  madeBy: string;
  timestamp: Date;
  confidence: number;
}

export interface Assumption {
  id: string;
  description: string;
  confidence: number;
  validatedBy?: string;
  timestamp: Date;
}

export interface Constraint {
  id: string;
  type: 'technical' | 'resource' | 'time' | 'business';
  description: string;
  impact: 'low' | 'medium' | 'high';
}

export interface TaskCompletion {
  taskId: string;
  completedBy: string;
  startTime: Date;
  endTime: Date;
  success: boolean;
  metrics: TaskMetrics;
  insights: string[];
  issues: string[];
}

export interface TaskMetrics {
  duration: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  testsAdded: number;
  testsPassed: number;
  coverage: number;
}

export interface ErrorPattern {
  id: string;
  pattern: string;
  frequency: number;
  lastSeen: Date;
  solutions: string[];
  preventionMeasures: string[];
}

export interface KnowledgeSynthesis {
  sources: AgentContribution[];
  synthesizedKnowledge: Knowledge;
  confidence: number;
  conflicts?: Conflict[];
  resolution?: ResolutionStrategy;
}

export interface AgentContribution {
  agentId: string;
  contribution: string;
  timestamp: Date;
  confidence: number;
  evidence: string[];
}

export interface Knowledge {
  id: string;
  type: string;
  content: any;
  metadata: KnowledgeMetadata;
  version: number;
  contributors: string[];
}

export interface KnowledgeMetadata {
  created: Date;
  updated: Date;
  quality: number;
  verifiedBy: string[];
  tags: string[];
}

export interface Conflict {
  id: string;
  type: 'data' | 'decision' | 'approach' | 'priority';
  description: string;
  parties: string[];
  proposals: ConflictProposal[];
  status: 'open' | 'resolved' | 'escalated';
}

export interface ConflictProposal {
  proposedBy: string;
  solution: string;
  rationale: string;
  support: string[];
  opposition: string[];
}

export interface ResolutionStrategy {
  type: 'consensus' | 'voting' | 'expertise' | 'hierarchy' | 'compromise';
  description: string;
  result: string;
  implementedBy: string;
  timestamp: Date;
}

export interface AgentAssignment {
  id: string;
  agentId: string;
  taskId: string;
  assignedAt: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'handed_off';
  progress: number;
  estimatedCompletion?: Date;
}

export interface CollaborationPattern {
  name: string;
  description: string;
  agents: AgentRole[];
  workflow: WorkflowStep[];
  coordination: CoordinationType;
  communication: CommunicationProtocol;
}

export interface AgentRole {
  role: string;
  responsibilities: string[];
  requiredCapabilities: string[];
  minReputation?: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  assignedRole: string;
  dependencies: string[];
  outputs: string[];
  estimatedDuration: number;
}

export type CoordinationType = 'synchronous' | 'asynchronous' | 'parallel' | 'sequential' | 'voting';
export type CommunicationProtocol = 'realtime' | 'comment-based' | 'broadcast' | 'handoff' | 'proposal-based';

export interface TaskDistribution {
  strategy: 'round-robin' | 'expertise' | 'load-balanced' | 'auction' | 'performance-based';
  assignments: Map<string, string[]>;
  rationale: string;
  expectedCompletion: Date;
}

export interface AgentPerformance {
  agentId: string;
  period: { start: Date; end: Date };
  tasksCompleted: number;
  avgCompletionTime: number;
  successRate: number;
  errorRate: number;
  handoffRate: number;
  collaborationScore: number;
}