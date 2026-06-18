import type { DeploymentPhase, DeploymentStatus } from '@foundry/shared';

const TERMINAL_PHASES: ReadonlySet<DeploymentPhase> = new Set([
  'succeeded',
  'failed',
  'destroyed',
]);

/** A deployment is "done" (logs stream can stop) once it reaches a terminal phase. */
export function isTerminal(phase: DeploymentPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

interface Entry {
  status: DeploymentStatus;
  /** Append-only; read by cursor for streaming. */
  logs: string[];
}

/**
 * In-memory deployment registry: a status record + an append-only log buffer
 * per id. PoC-grade — everything here is lost on a server restart. The durable
 * record is each workdir's `meta.json` (written by the executor), which lets
 * teardown still locate a deployment's Terraform state after a restart even
 * though its in-memory status is gone.
 */
export class DeploymentStore {
  private readonly entries = new Map<string, Entry>();

  create(status: DeploymentStatus): void {
    this.entries.set(status.id, { status, logs: [] });
  }

  get(id: string): DeploymentStatus | undefined {
    return this.entries.get(id)?.status;
  }

  list(): DeploymentStatus[] {
    return [...this.entries.values()].map((e) => e.status);
  }

  /** Patch status fields and bump `updatedAt`. No-op for an unknown id. */
  update(id: string, patch: Partial<DeploymentStatus>): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    entry.status = { ...entry.status, ...patch, updatedAt: new Date().toISOString() };
  }

  appendLog(id: string, line: string): void {
    this.entries.get(id)?.logs.push(line);
  }

  /** Return log lines from `cursor` onward plus the cursor to resume from. */
  readLogs(id: string, cursor: number): { lines: string[]; nextCursor: number } | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }
    const start = Math.max(0, Number.isFinite(cursor) ? cursor : 0);
    return { lines: entry.logs.slice(start), nextCursor: entry.logs.length };
  }
}
