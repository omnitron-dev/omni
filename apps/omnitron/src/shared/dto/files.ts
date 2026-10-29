/** File protocol v1. Paths are POSIX, relative to an explicitly exported root. */
export interface FileRootConfig {
  id: string;
  label: string;
  path: string;
  readOnly?: boolean;
}
export interface FileRoot {
  id: string;
  label: string;
  readOnly: boolean;
}
export interface FileLocation {
  nodeId: string;
  rootId: string;
  path: string;
}
export interface FileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink' | 'special';
  size: number;
  modifiedAt: string;
  mode: number;
  version: string;
}
export interface FileListing {
  entries: FileEntry[];
  next: string | null;
  revision: string;
}
export interface FileDocument {
  content: string;
  version: string;
  bytes: number;
  bom: boolean;
}
export interface FileChunk {
  data: string;
  sha256: string;
  offset: number;
  eof: boolean;
}
export interface FileUpload {
  id: string;
  offset: number;
  size: number;
  state: 'receiving' | 'committing' | 'complete' | 'aborted';
  sha256?: string;
}
export interface FileTrash {
  id: string;
  rootId: string;
  path: string;
  removedAt: string;
  restored: boolean;
}
export interface FileCopyRequest {
  sources: Array<FileLocation & { version: string }>;
  destination: FileLocation;
}
export interface FileTransfer {
  id: string;
  ownerId: string;
  state: 'planning' | 'running' | 'paused' | 'interrupted' | 'failed' | 'completed' | 'cancelled';
  source: FileLocation[];
  destination: FileLocation;
  bytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
export type FileNodeRequest =
  | { op: 'roots' }
  | { op: 'list'; rootId: string; path: string; after?: string; revision?: string }
  | { op: 'stat'; rootId: string; path: string }
  | { op: 'readText'; rootId: string; path: string }
  | { op: 'readChunk'; rootId: string; path: string; version: string; offset: number }
  | { op: 'saveText'; rootId: string; path: string; content: string; version: string | null; bom?: boolean }
  | { op: 'mkdir'; rootId: string; path: string }
  | { op: 'rename'; rootId: string; path: string; destination: string; version: string }
  | { op: 'trash'; rootId: string; path: string; version: string }
  | { op: 'trashList'; rootId: string }
  | { op: 'restore'; id: string }
  | { op: 'beginWrite'; rootId: string; path: string; size: number; id?: string }
  | { op: 'writeChunk'; id: string; offset: number; data: string; sha256: string }
  | { op: 'writeStatus'; id: string }
  | { op: 'commitWrite'; id: string }
  | { op: 'abortWrite'; id: string }
  | { op: 'acknowledgeWrite'; id: string };
export interface IOmnitronFileNodeService {
  invoke(data: { actor: string; request: FileNodeRequest }): Promise<unknown>;
}
export interface IOmnitronFilesService {
  roots(data: { nodeId: string }): Promise<{ protocol: 1; roots: FileRoot[] }>;
  list(data: FileLocation & { after?: string; revision?: string }): Promise<FileListing>;
  stat(data: FileLocation): Promise<FileEntry>;
  readText(data: FileLocation): Promise<FileDocument>;
  readChunk(data: FileLocation & { version: string; offset: number }): Promise<FileChunk>;
  saveText(data: FileLocation & { content: string; version: string | null; bom?: boolean }): Promise<FileDocument>;
  mkdir(data: FileLocation): Promise<FileEntry>;
  rename(data: FileLocation & { destination: string; version: string }): Promise<FileEntry>;
  trash(data: FileLocation & { version: string }): Promise<FileTrash>;
  trashList(data: { nodeId: string; rootId: string }): Promise<FileTrash[]>;
  restore(data: { nodeId: string; id: string }): Promise<FileTrash>;
  beginUpload(data: FileLocation & { size: number; id?: string }): Promise<FileUpload>;
  uploadChunk(data: { nodeId: string; id: string; offset: number; data: string; sha256: string }): Promise<FileUpload>;
  uploadStatus(data: { nodeId: string; id: string }): Promise<FileUpload>;
  finishUpload(data: { nodeId: string; id: string }): Promise<FileUpload>;
  acknowledgeUpload(data: { nodeId: string; id: string }): Promise<void>;
  abortUpload(data: { nodeId: string; id: string }): Promise<FileUpload>;
  copy(data: FileCopyRequest): Promise<FileTransfer>;
  transfers(): Promise<FileTransfer[]>;
  controlTransfer(data: { id: string; action: 'pause' | 'resume' | 'cancel' }): Promise<FileTransfer>;
}
