import type { ValidationError } from '@foundry/shared';

/**
 * Thrown by a resolver / the generator when a blueprint id (or version) does
 * not exist. The server maps this to a 404.
 */
export class BlueprintNotFoundError extends Error {
  constructor(
    public readonly blueprintId: string,
    public readonly version?: string,
  ) {
    super(
      version
        ? `Blueprint not found: ${blueprintId}@${version}`
        : `Blueprint not found: ${blueprintId}`,
    );
    this.name = 'BlueprintNotFoundError';
  }
}

/**
 * Thrown by the generator when submitted config fails validation against the
 * manifest's input schema. The server maps this to a 400 with `{ errors }`.
 */
export class ConfigValidationError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(`Config validation failed (${errors.length} error(s))`);
    this.name = 'ConfigValidationError';
  }
}
