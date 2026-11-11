/** Repository policy. Xec supplies execution; Omnitron supplies the release recipe. */
export default {
  repository: 'omnitron-dev/omni',
  branch: 'main',
  qualification: {
    provider: 'github',
    workflow: 'ci.yml',
    nativeWorkflow: 'qualify-managed-handoff.yml',
    nodes: ['22.23.4', '24.10.0'],
    jobs: ['Typecheck', 'Full workspace tests', 'Workspace lint', 'Reproduce the full backend and Console', 'Standing checks'],
    pollMs: 15_000,
    timeoutMs: 60 * 60_000,
  },
};
