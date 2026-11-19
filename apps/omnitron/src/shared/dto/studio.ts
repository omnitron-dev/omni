import type {
  StudioProvider,
  StudioModelCatalog,
  StudioModelRequirements,
  StudioModelSelection,
  StudioRole,
  StudioResultClass,
  StudioUsageReport,
  StudioCostTier,
  createStudioProviderInput,
} from './studio-policy.js';
import type { FlowDefinition } from './flows.js';

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
  leadMemberId: string;
  title: string;
  provider: StudioProvider;
  updatedAt: number;
  stack: string | null;
  assignment: StudioDecision;
}

export interface StudioPreferences {
  purpose?: 'project-interview';
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
  memberId: string;
  authorId: string | null;
  kind: 'message' | 'task' | 'summary';
  originId: string | null;
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
  team: StudioTeam;
}

export interface StudioTeamPolicy {
  providers: StudioProvider[];
  maxMembers: number;
  maxDelegations: number;
  maxCostTier: StudioCostTier;
}
export interface StudioMember {
  id: string;
  name: string;
  provider: StudioProvider;
  assignment: StudioDecision;
  lead: boolean;
  active: boolean;
}
export interface StudioNote {
  key: string;
  text: string;
  revision: number;
  authorId: string | null;
  updatedAt: number;
}
export interface StudioTeam {
  policy: StudioTeamPolicy | null;
  members: StudioMember[];
  notes: StudioNote[];
  tasks: StudioTurn[];
  proposals: StudioFlowProposal[];
}
export interface StudioFlowProposal {
  id: string;
  name: string;
  authorId: string;
  createdAt: number;
}
export interface StudioRoomRef {
  project: string | null;
  threadId: string;
}
export interface StudioMemberInput {
  name: string;
  provider: StudioProvider;
  preferences: StudioPreferences;
}
export interface StudioPost extends StudioRoomRef {
  turnId: string;
  memberId: string;
  kind: 'task' | 'message';
  text: string;
}
export interface StudioNoteInput {
  key: string;
  text: string;
  revision: number;
}
export const STUDIO_TEAM_TOOLS = [
  'team_state',
  'team_catalog',
  'team_invite',
  'team_assign',
  'team_note',
  'team_message',
  'flow_catalog',
  'flow_preview',
  'flow_propose',
] as const;
export type StudioTeamTool = (typeof STUDIO_TEAM_TOOLS)[number];

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
  teamTools?: boolean;
};

export type StudioResult =
  | { status: 'completed'; answer: string; conversation: string; usage?: StudioUsageReport }
  | { status: 'failed'; failure: StudioFailure };

export interface IOmnitronStudioService {
  workspace(data: { project: string | null; stack?: string; before?: StudioThreadCursor }): Promise<StudioWorkspace>;
  thread(data: { project: string | null; threadId: string; before?: string }): Promise<StudioHistory>;
  createTeam(
    data: StudioRoomRef &
      StudioMemberInput & {
        title: string;
        stack?: string;
        policy: StudioTeamPolicy;
      }
  ): Promise<{ threadId: string }>;
  configureTeam(data: StudioRoomRef & { policy: StudioTeamPolicy; previous: StudioTeamPolicy | null }): Promise<void>;
  addMember(data: StudioRoomRef & StudioMemberInput & { memberId: string }): Promise<{ memberId: string }>;
  retireMember(data: StudioRoomRef & { memberId: string }): Promise<void>;
  post(data: StudioPost): Promise<{ threadId: string; turnId: string }>;
  writeNote(data: StudioRoomRef & StudioNoteInput): Promise<StudioNote>;
  flowProposal(data: StudioRoomRef & { proposalId: string }): Promise<{ definition: FlowDefinition; stack: string | null }>;
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
    capacity?: number;
  }): Promise<{ connection: string }>;
  nextTurn(data: { connection: string }): Promise<StudioTask | null>;
  heartbeat(data: { connection: string; turnId: string; preview?: string }): Promise<{ active: boolean }>;
  finishTurn(data: { connection: string; turnId: string; result: StudioResult }): Promise<void>;
  teamTool(data: {
    connection: string;
    turnId: string;
    name: StudioTeamTool;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
  disconnectAdapter(data: { connection: string }): Promise<void>;
}
