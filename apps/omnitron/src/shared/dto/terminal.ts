/** Interactive SSH is a control-plane capability, independent of application RPC. */
export interface TerminalPolicy {
  enabled: boolean;
  maxSessions: number;
  maxSessionsPerOwner: number;
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  disconnectTimeoutMs: number;
}

export interface TerminalSession {
  id: string;
  nodeId: string;
  nodeName: string;
  host: string;
  username: string;
  fingerprint: string;
  createdAt: string;
  state: 'connecting' | 'open' | 'closed';
  reason?: string;
  exitCode?: number;
  cols: number;
  rows: number;
}

export interface TerminalHostKey {
  nodeId: string;
  host: string;
  port: number;
  /** Observed over an unauthenticated handshake; verify independently before trusting. */
  observed: string;
  trusted: string | null;
}

export interface TerminalRead {
  /** Byte offset of the next read. Bytes are transported as base64 without UTF-8 loss. */
  cursor: number;
  data: string;
  droppedBytes: number;
  hasMore: boolean;
  session: TerminalSession;
}
