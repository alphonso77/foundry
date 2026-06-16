/**
 * @foundry/shared — the single source of truth for Foundry's contracts.
 *
 * Every type here is defined by the coordination file's Contracts section.
 * Both the backend packages (generator, server) and the portal frontend
 * import from here so the portal renders forms from the same schema the
 * generator validates against. Do not fork these shapes.
 */

// ─── Resolver interfaces (storage-agnostic; ports-and-adapters boundary) ──────

/**
 * The generator only ever talks to a resolver — never to storage layout
 * directly. Each storage backend (folder, git-ref, package) is one
 * implementation that returns these normalized shapes.
 */
export interface BlueprintResolver {
  list(): Promise<BlueprintSummary[]>;
  getManifest(id: string, version?: string): Promise<BlueprintManifest>;
  getFiles(id: string, version?: string): Promise<BlueprintFile[]>;
}

export interface BlueprintSummary {
  id: string;
  name: string;
  description: string;
}

export interface BlueprintManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Form fields + validation source of truth. */
  inputs: InputSchema;
  /** Relative file ids only — never absolute paths. Includes `.hbs` suffixes. */
  files: string[];
  /** Named deploy target, e.g. "aws-ecs". */
  deployTarget: string;
}

export interface BlueprintFile {
  /**
   * Relative output path, INCLUDING any `.hbs` suffix exactly as stored on
   * disk. The generator strips `.hbs` when emitting.
   */
  path: string;
  /** Raw template source. */
  contents: string;
}

// ─── Input schema (portal renders it; generator validates against it) ─────────

export interface InputSchema {
  fields: InputField[];
}

export type InputField = StringField | BooleanField | SelectField | MultiselectField;

export interface StringField {
  key: string;
  label: string;
  type: 'string';
  required?: boolean;
  default?: string;
  placeholder?: string;
  /** Regex source string; the value must match if provided. */
  pattern?: string;
  help?: string;
}

export interface BooleanField {
  key: string;
  label: string;
  type: 'boolean';
  default?: boolean;
  help?: string;
}

export interface SelectField {
  key: string;
  label: string;
  type: 'select';
  options: SelectOption[];
  default?: string;
  required?: boolean;
  help?: string;
}

export interface MultiselectField {
  key: string;
  label: string;
  type: 'multiselect';
  options: SelectOption[];
  default?: string[];
  help?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

// ─── HTTP API DTOs ────────────────────────────────────────────────────────────

export interface GenerateRequest {
  blueprintId: string;
  version?: string;
  /** Keyed by InputField.key. */
  config: Record<string, unknown>;
}

export interface ValidationError {
  field: string;
  message: string;
}

/** Error body returned by GET /api/blueprints/:id (404) and /api/generate (404). */
export interface ErrorResponse {
  error: string;
}

/** Error body returned by POST /api/generate on validation failure (400). */
export interface ValidationErrorResponse {
  errors: ValidationError[];
}

/** GET /api/health */
export interface HealthResponse {
  ok: true;
}
