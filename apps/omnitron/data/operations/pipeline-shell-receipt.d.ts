export function pipelineShellReceipt(run: unknown): {
  protocol: 'omnitron.pipeline.shell-receipt/1';
  id: string;
  review: string;
  digest: string;
};
