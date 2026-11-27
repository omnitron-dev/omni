interface Pins {
  sourceNode: string;
  receiverNode: string;
  sourceFingerprint: string;
  receiverFingerprint: string;
}
interface StopScope {
  project: string;
  stack: string;
  sourceNode: string;
  sourceIp: string;
}
export function registeredPinArgs(nodeId: string, fingerprint: string): string[];
export function registeredPinCommand(nodeId: string, fingerprint: string): string;
export function registeredPinsStep(spec: Pins): { name: string; run: string; timeout: number };
export function fullStopArgs(scope: StopScope, stop: string): string[];
export function fullStopCommand(scope: StopScope, stop: string): string;
