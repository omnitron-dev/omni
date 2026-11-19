import type {
  StudioProvider,
  StudioModelCatalog,
  StudioModelRequirements,
  StudioModelSelection,
  StudioRole,
  StudioResultClass,
  StudioUsageReport,
  createStudioProviderInput,
} from './studio-policy.js';

export { STUDIO_PROVIDERS, type StudioProvider } from './studio-policy.js';
export { projectInterview, readProjectSuggestion } from './studio-starter.js';
export type StudioStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
export type StudioFailure =
  | 'authorization'
  | 'model-changed'
  | 'scope-unavailable'
  | 'sign-in'
  | 'provider'
  | 'protocol'
  | 'timeout'
  | 'disconnected';

export interface StudioThread {
  id: string;
  title: string;
  provider: StudioProvider;
  updatedAt: number;
  stack: string | null;
  assignment: StudioDecision;
}

export interface StudioPreferences {
  role: StudioRole;
  result: StudioResultClass;
  requirements: StudioModelRequirements;
  model?: string;
}

export interface StudioDecision {
  preferences: StudioPreferences;
  selection: StudioModelSelection;
}

export interface StudioTurn {
  id: string;
  prompt: string;
  answer: string;
  status: StudioStatus;
  failure: StudioFailure | null;
  createdAt: number;
  usage: StudioUsageReport | null;
  review: StudioReview | null;
}

export interface StudioReview {
  outcome: 'accepted' | 'needs-work';
  note: string;
  at: number;
}

export interface StudioWorkspace {
  account: string;
  catalogs: StudioModelCatalog[];
  threads: StudioThread[];
  older: StudioThreadCursor | null;
}

export type StudioThreadCursor = Pick<StudioThread, 'updatedAt' | 'id'>;
export interface StudioHistory {
  thread: StudioThread;
  turns: StudioTurn[];
  beforeTurn: string | null;
}

export interface StudioSend {
  project: string | null;
  provider: StudioProvider;
  threadId: string;
  turnId: string;
  after: string | null;
  prompt: string;
  stack?: string;
  preferences: StudioPreferences;
}

export type StudioTask = ReturnType<typeof createStudioProviderInput> & {
  turnId: string;
};

export type StudioResult =
  | { status: 'completed'; answer: string; conversation: string; usage?: StudioUsageReport }
  | { status: 'failed'; failure: StudioFailure };

export interface IOmnitronStudioService {
  workspace(data: { project: string | null; stack?: string; before?: StudioThreadCursor }): Promise<StudioWorkspace>;
  thread(data: { project: string | null; threadId: string; before?: string }): Promise<StudioHistory>;
  send(data: StudioSend): Promise<{ threadId: string; turnId: string }>;
  cancel(data: {
    project: string | null;
    threadId: string;
    turnId: string;
  }): Promise<{ status: StudioStatus | 'withdrawn' }>;
  review(data: {
    project: string | null;
    threadId: string;
    turnId: string;
    outcome: StudioReview['outcome'];
    note: string;
    previous: number | null;
  }): Promise<void>;

  /** These methods additionally require the machine-local operator identity. */
  connectAdapter(data: {
    project: string | null;
    account: string;
    catalog: StudioModelCatalog;
    directory: string | null;
  }): Promise<{ connection: string }>;
  nextTurn(data: { connection: string }): Promise<StudioTask | null>;
  heartbeat(data: { connection: string; turnId: string; preview?: string }): Promise<{ active: boolean }>;
  finishTurn(data: { connection: string; turnId: string; result: StudioResult }): Promise<void>;
  disconnectAdapter(data: { connection: string }): Promise<void>;
}
