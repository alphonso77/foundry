import type {
  BlueprintManifest,
  BlueprintSummary,
  GenerateRequest,
  ValidationError,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export async function listBlueprints(): Promise<BlueprintSummary[]> {
  const res = await fetch(`${API_BASE}/blueprints`);
  if (!res.ok) {
    throw new Error(`Failed to load blueprints (HTTP ${res.status})`);
  }
  return (await res.json()) as BlueprintSummary[];
}

export async function getManifest(id: string): Promise<BlueprintManifest> {
  const res = await fetch(`${API_BASE}/blueprints/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to load blueprint "${id}" (HTTP ${res.status})`);
  }
  return (await res.json()) as BlueprintManifest;
}

/** Thrown when the server rejects a config with 400 + field-level errors. */
export class ValidationFailure extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super('The server rejected this configuration.');
    this.name = 'ValidationFailure';
    this.errors = errors;
  }
}

/** POST /api/generate. Resolves to a zip Blob on success. */
export async function generate(req: GenerateRequest): Promise<Blob> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (res.status === 400) {
    const body = (await res.json().catch(() => ({ errors: [] }))) as {
      errors?: ValidationError[];
    };
    throw new ValidationFailure(body.errors ?? []);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Generation failed (HTTP ${res.status})`);
  }
  return res.blob();
}
