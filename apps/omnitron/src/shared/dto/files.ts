/** File protocol v1. Paths are POSIX, relative to an explicitly exported root. */
export interface FileRootConfig {
  id: string;
  label: string;
  path: string;
  readOnly?: boolean;
  /** Root-relative structural entries which cannot be renamed/trashed; children remain usable. */
  protectedPaths?: string[];
}
export interface FileRoot {
  id: string;
  label: string;
  readOnly: boolean;
  /** Advisory UI projection; the node always enforces the policy independently. */
  protectedPaths?: string[];
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
  state: 'receiving' | 'committing' | 'complete' | 'aborted' | 'failed';
  phase?: 'restoring' | 'publishing';
  restoredBytes?: number;
  publication?: 'partial' | 'complete';
  error?: string;
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
  /** One selected directory; output is explicit and never inferred from a filename. */
  archive?: FileArchiveOptions;
}
export const FILE_ARCHIVE_FORMATS = ['tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst', 'zip', '7z'] as const;
export type FileArchiveFormat = (typeof FILE_ARCHIVE_FORMATS)[number];
export interface FileArchiveOptions { format: FileArchiveFormat; name: string; output: 'archive' | 'directory' }
export interface ArchiveFormatCapability {
  format: FileArchiveFormat; label: string; extension: string;
  /** Destination decoding is independently probed when a destination node is supplied. */
  outputs: Array<'archive' | 'directory'>;
}
export interface FileArchiveCapabilities { formats: ArchiveFormatCapability[]; observedAt: string; limitations: string[] }
export interface FileArchiveManifest {
  protocol: 1;
  rootName: string;
  /** Ordered payload layout; decoder bytes never control filesystem paths. */
  entries: Array<{ path: string; kind: 'directory' | 'file'; size: number; mode: number; sha256?: string }>;
}
export interface FileArchiveStatus {
  id: string; state: 'preparing' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
  phase: 'planning' | 'snapshotting' | 'archiving';
  preparedBytes: number; sourceBytes: number;
  file?: FileEntry; manifest?: FileArchiveManifest; error?: string;
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
  archive?: FileArchiveOptions;
  phase?: 'planning' | 'snapshotting' | 'archiving' | 'transferring' | 'restoring' | 'publishing';
  preparedBytes?: number;
  sourceBytes?: number;
  restoredBytes?: number;
  publication?: 'partial' | 'complete';
  error?: string;
  /** Publication/cancellation succeeded; temporary source data or destination receipt cleanup remains pending. */
  cleanupPending?: boolean;
  createdAt: string;
  updatedAt: string;
}
export type FileNodeRequest =
  | { op: 'roots' }
  | { op: 'archiveFormats' }
  | { op: 'prepareArchive'; id: string; rootId: string; path: string; version: string; format: FileArchiveFormat }
  | { op: 'archiveStatus'; id: string }
  | { op: 'readArchive'; id: string; version: string; offset: number }
  | { op: 'abortArchive'; id: string }
  | { op: 'releaseArchive'; id: string }
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
  | { op: 'beginWrite'; rootId: string; path: string; size: number; id?: string; sha256?: string }
  | { op: 'beginArchiveWrite'; rootId: string; path: string; size: number; id: string; format: FileArchiveFormat; manifest: FileArchiveManifest; sha256: string }
  | { op: 'writeChunk'; id: string; offset: number; data: string; sha256: string }
  | { op: 'writeStatus'; id: string }
  | { op: 'commitWrite'; id: string }
  | { op: 'abortWrite'; id: string }
  | { op: 'acknowledgeWrite'; id: string };
export interface IOmnitronFileNodeService {
  invoke(data: { actor: string; request: FileNodeRequest }): Promise<unknown>;
}
export interface IOmnitronFilesService {
  archiveFormats(data: { nodeId: string; destinationNodeId?: string }): Promise<FileArchiveCapabilities>;
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
