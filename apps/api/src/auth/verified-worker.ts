import type { WorkerPrincipal } from './principal.js';

// Trust is tied to this exact, server-created principal object. Token/JSON fields
// and copies of the principal cannot forge verification. Never put principals in Redis.
const verifiedWorkers = new WeakSet<WorkerPrincipal>();

export function markVerifiedWorker(principal: WorkerPrincipal): void {
  verifiedWorkers.add(principal);
}

export function isVerifiedWorker(principal: WorkerPrincipal): boolean {
  return verifiedWorkers.has(principal);
}
