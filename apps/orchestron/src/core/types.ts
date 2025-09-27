import { z } from 'zod';

export type NodeId = string;
export type EdgeId = string;
export type BranchName = string;

export enum Author {
  HUMAN = 'HUMAN',
  AI = 'AI',
  SYSTEM = 'SYSTEM',
}

export enum DevelopmentNodeType {
  // Strategic nodes
  ARCHITECTURE = 'architecture',
  SPECIFICATION = 'specification',
  MILESTONE = 'milestone',

  // Task management nodes
  EPIC = 'epic',
  STORY = 'story',
  TASK = 'task',
  SUBTASK = 'subtask',
  TODO = 'todo',

  // Sprint planning
  SPRINT = 'sprint',
  PLANNING = 'planning',
  RETROSPECTIVE = 'retrospective',

  // Implementation nodes
  MODULE = 'module',
  FEATURE = 'feature',
  OPTIMIZATION = 'optimization',
  REFACTOR = 'refactor',
  INTEGRATION = 'integration',
  COMMIT = 'commit',

  // Quality nodes
  TEST = 'test',
  BENCHMARK = 'benchmark',
  REVIEW = 'review',

  // Issue tracking
  BUG = 'bug',
  FIX = 'fix',
  ERROR = 'error',
  INCIDENT = 'incident',

  // Knowledge nodes
  INSIGHT = 'insight',
  RESEARCH = 'research',
  EXPERIMENT = 'experiment',
  DECISION = 'decision',

  // Documentation
  DOCUMENTATION = 'documentation',
  EXAMPLE = 'example',
  TUTORIAL = 'tutorial',

  // Automation
  WORKFLOW = 'workflow',
  TRIGGER = 'trigger',
  ACTION = 'action',
}

export enum DevelopmentEdgeType {
  // Causal relationships
  IMPLEMENTS = 'implements',
  FIXES = 'fixes',
  OPTIMIZES = 'optimizes',
  REFACTORS = 'refactors',

  // Logical relationships
  REQUIRES = 'requires',
  CONFLICTS = 'conflicts',
  SUPERSEDES = 'supersedes',
  PARENT_OF = 'parent_of',
  BLOCKS = 'blocks',

  // Testing relationships
  TESTS = 'tests',
  VALIDATES = 'validates',
  BENCHMARKS = 'benchmarks',

  // Knowledge relationships
  DOCUMENTS = 'documents',
  EXPLAINS = 'explains',
  REFERENCES = 'references',

  // Task relationships
  ASSIGNED_TO = 'assigned_to',
  REVIEWED_BY = 'reviewed_by',
  IN_SPRINT = 'in_sprint',
}

export enum TaskStatus {
  BACKLOG = 'backlog',
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  IN_REVIEW = 'review',
  TESTING = 'testing',
  DONE = 'done',
  CANCELLED = 'cancelled',
  BLOCKED = 'blocked',
}

export enum Priority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  TRIVIAL = 'trivial',
}

export interface Checkpoint {
  name: string;
  completed: boolean;
  timestamp?: Date;
}

export interface TaskNode extends Node {
  nodeType: DevelopmentNodeType.EPIC | DevelopmentNodeType.STORY |
           DevelopmentNodeType.TASK | DevelopmentNodeType.SUBTASK |
           DevelopmentNodeType.TODO;
  payload: {
    title: string;
    description?: string;
    status: TaskStatus;
    priority: Priority;

    // Planning
    estimatedHours?: number;
    actualHours?: number;
    startDate?: Date;
    dueDate?: Date;
    completedDate?: Date;

    // Assignment
    assignee?: string;
    reviewers?: string[];
    watchers?: string[];

    // Dependencies
    blockedBy?: NodeId[];
    blocking?: NodeId[];
    parentTask?: NodeId;
    subtasks?: NodeId[];

    // Context
    component?: string;
    labels?: string[];
    sprint?: NodeId;

    // Progress
    progress?: number; // 0-100
    checkpoints?: Checkpoint[];

    // Integration
    gitBranch?: string;
    pullRequest?: string;
    commits?: string[];
    files?: string[];
  };
}

export interface SprintNode extends Node {
  nodeType: DevelopmentNodeType.SPRINT;
  payload: {
    name: string;
    goal: string;
    startDate: Date;
    endDate: Date;

    // Planning
    velocity?: number;
    capacity?: number;

    // Tasks
    committedTasks: NodeId[];
    completedTasks: NodeId[];
    carryOverTasks: NodeId[];

    // Metrics
    burndown?: BurndownData;
    metrics?: SprintMetrics;

    // Review
    retrospective?: {
      whatWentWell: string[];
      whatCouldImprove: string[];
      actionItems: NodeId[];
    };
  };
}

export interface BurndownData {
  dates: Date[];
  ideal: number[];
  actual: number[];
  scopeChanges: Array<{ date: Date; delta: number }>;
}

export interface SprintMetrics {
  plannedPoints: number;
  completedPoints: number;
  velocityTrend: number[];
  scopeChangeCount: number;
  defectCount: number;
  cycleTime: number; // Average hours per task
}

export interface DevelopmentMetadata {
  linesAdded?: number;
  linesRemoved?: number;
  filesModified?: string[];
  complexity?: number;
  executionTime?: number;
  memoryUsage?: number;
  throughput?: number;
  testCoverage?: number;
  warningCount?: number;
  errorCount?: number;
  language?: string;
  framework?: string;
  priority?: Priority;
  status?: TaskStatus;
  reviewed?: boolean;
  approvedBy?: string;
  reviewComments?: string[];

  // Time tracking
  timeSpent?: number;
  timeEstimate?: number;
  timerStart?: Date;

  // Quality metrics
  codeSmells?: number;
  duplicateLines?: number;
  maintainabilityIndex?: number;

  // Task management
  assignee?: string;
  component?: string;
  author?: string;
}

export interface Node {
  nodeId: NodeId;
  author: Author;
  timestamp: Date;
  parentIds: NodeId[];
  nodeType: DevelopmentNodeType;
  payload: Record<string, any>;
  metadata: DevelopmentMetadata;
}

export interface Edge {
  edgeId: EdgeId;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  edgeType: DevelopmentEdgeType;
  metadata?: Record<string, any>;
}

export interface Branch {
  name: BranchName;
  headNodeId: NodeId;
  createdAt: Date;
  description?: string;
  isActive?: boolean;
  parentBranch?: BranchName;
  mergedInto?: BranchName;
  mergedAt?: Date;
}

// Request/Response types
export interface CommitRequest {
  nodes: (Omit<Node, 'timestamp'> & { nodeId?: NodeId })[];
  edges: Omit<Edge, 'edgeId'>[];
  message?: string;
}

export interface CommitResponse {
  success: boolean;
  commitId: NodeId;
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
}

export interface BranchRequest {
  name: BranchName;
  fromNodeId?: NodeId;
  description?: string;
}

export interface BranchResponse {
  success: boolean;
  branch: Branch;
}

export enum MergeStrategy {
  FAST_FORWARD = 'fast_forward',
  RECURSIVE = 'recursive',
  SQUASH = 'squash',
  REBASE = 'rebase',
}

export interface MergeRequest {
  fromBranch: BranchName;
  intoBranch: BranchName;
  strategy: MergeStrategy;
  message?: string;
}

export interface MergeResponse {
  success: boolean;
  mergeNodeId?: NodeId;
  conflicts?: string[];
}

export interface BlameResponse {
  path: Node[];
  edges: Edge[];
  depth: number;
}

export interface DiffResponse {
  addedNodes: Node[];
  removedNodes: Node[];
  modifiedNodes: Array<{
    before: Node;
    after: Node;
  }>;
  addedEdges: Edge[];
  removedEdges: Edge[];
}

export interface FileChange {
  path: string;
  diff?: string;
  content?: string;
  action: 'create' | 'modify' | 'delete';
}

// Analytics types
export interface DevelopmentMetrics {
  totalNodes: number;
  nodesByType: Record<DevelopmentNodeType, number>;
  totalEdges: number;
  edgesByType: Record<DevelopmentEdgeType, number>;
  activeBranches: number;
  errorRate: number;
  averageComplexity: number;
  testCoverage: number;
  performanceImprovement: number;

  // Task metrics
  totalTasks: number;
  tasksCompleted: number;
  tasksInProgress: number;
  tasksBlocked: number;
  averageCycleTime: number;

  // Sprint metrics
  sprintVelocity: number;
  sprintProgress: number;
  predictedCompletion: Date | null;
}

export interface ErrorPattern {
  pattern: string;
  frequency: number;
  lastOccurrence: Date;
  relatedNodes: NodeId[];
  suggestedFix?: string;
}

export interface SearchOptions {
  types?: DevelopmentNodeType[];
  dateRange?: { from: Date; to: Date };
  assignee?: string;
  status?: TaskStatus[];
  priority?: Priority[];
  component?: string;
  labels?: string[];
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'priority' | 'status';
}

export interface Statistics {
  totalTasks: number;
  completedToday: number;
  inProgress: number;
  blocked: number;
  overdue: number;

  velocity: number;
  cycleTime: number;
  leadTime: number;
  throughput: number;

  codeMetrics: {
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
    testCoverage: number;
  };

  errorRate: number;
  bugFixTime: number;
  deploymentFrequency: number;
}

export interface WorkflowDefinition {
  id: NodeId;
  name: string;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  conditions?: ConditionDefinition[];
  enabled: boolean;
  lastRun?: Date;
  runCount?: number;
}

export interface TriggerDefinition {
  type: 'task_created' | 'status_change' | 'schedule' | 'event';
  config: Record<string, any>;
}

export interface ActionDefinition {
  type: 'create_task' | 'update_status' | 'assign' | 'notify' | 'run_command';
  config: Record<string, any>;
}

export interface ConditionDefinition {
  type: 'if' | 'unless' | 'when';
  expression: string;
}

// Navigation types
export interface NavigationHistory {
  back: NodeId[];
  forward: NodeId[];
  current: NodeId | null;
}

export interface Bookmark {
  id: string;
  name: string;
  nodeId: NodeId;
  createdAt: Date;
}

export interface Context {
  currentBranch: BranchName;
  currentNode: NodeId | null;
  currentTask: NodeId | null;
  currentSprint: NodeId | null;
  workingDirectory: string;
}

// Time tracking types
export interface TimeEntry {
  taskId: NodeId;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  description?: string;
  assignee: string;
}

export interface TimesheetEntry {
  date: Date;
  entries: TimeEntry[];
  totalHours: number;
}

// Dashboard types
export interface Dashboard {
  widgets: Widget[];
  layout: LayoutConfig;
  refreshInterval: number;
  filters: DashboardFilter[];
}

export interface Widget {
  id: string;
  type: 'chart' | 'stat' | 'list' | 'timeline' | 'graph';
  title: string;
  config: Record<string, any>;
  data?: any;
}

export interface LayoutConfig {
  columns: number;
  rows: number;
  positions: Array<{
    widgetId: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

export interface DashboardFilter {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'between';
  value: any;
}

// Schemas for validation
export const NodeSchema = z.object({
  nodeId: z.string(),
  author: z.nativeEnum(Author),
  timestamp: z.date(),
  parentIds: z.array(z.string()),
  nodeType: z.nativeEnum(DevelopmentNodeType),
  payload: z.record(z.string(), z.any()),
  metadata: z.record(z.string(), z.any()),
});

export const EdgeSchema = z.object({
  edgeId: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  edgeType: z.nativeEnum(DevelopmentEdgeType),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const TaskNodeSchema = NodeSchema.extend({
  nodeType: z.enum([
    DevelopmentNodeType.EPIC,
    DevelopmentNodeType.STORY,
    DevelopmentNodeType.TASK,
    DevelopmentNodeType.SUBTASK,
    DevelopmentNodeType.TODO,
  ]),
  payload: z.object({
    title: z.string(),
    description: z.string().optional(),
    status: z.nativeEnum(TaskStatus),
    priority: z.nativeEnum(Priority),
  }).passthrough(),
});