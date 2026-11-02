/** One sealed build admitted by the controller's local publisher. */
export interface KernelCatalogEntry {
  commit: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  artifact: string;
  archive: string;
  bytes: number;
}
