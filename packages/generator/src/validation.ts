import type { InputField, InputSchema, ValidationError } from '@foundry/shared';

/** A config object with manifest defaults applied for any omitted fields. */
export type ResolvedConfig = Record<string, unknown>;

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Validate a raw config object against an input schema per the contract rules:
 * required present, type matches, select ∈ options, multiselect ⊆ options,
 * string matches `pattern` if given. Returns one ValidationError per problem
 * (empty array = valid). Unknown keys in `config` are ignored.
 */
export function validateConfig(
  config: Record<string, unknown>,
  schema: InputSchema,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of schema.fields) {
    const value = config[field.key];

    if (isMissing(value)) {
      if ((field.type === 'string' || field.type === 'select') && field.required) {
        errors.push({ field: field.key, message: `${field.label} is required.` });
      }
      // Missing-and-optional: a default is applied later; nothing to validate.
      continue;
    }

    switch (field.type) {
      case 'string':
        validateString(field, value, errors);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({ field: field.key, message: `${field.label} must be a boolean.` });
        }
        break;
      case 'select':
        validateSelect(field, value, errors);
        break;
      case 'multiselect':
        validateMultiselect(field, value, errors);
        break;
    }
  }

  return errors;
}

function validateString(
  field: Extract<InputField, { type: 'string' }>,
  value: unknown,
  errors: ValidationError[],
): void {
  if (typeof value !== 'string') {
    errors.push({ field: field.key, message: `${field.label} must be a string.` });
    return;
  }
  if (field.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(field.pattern);
    } catch {
      errors.push({
        field: field.key,
        message: `${field.label} has an invalid pattern in its blueprint.`,
      });
      return;
    }
    if (!re.test(value)) {
      errors.push({
        field: field.key,
        message: `${field.label} must match ${field.pattern}.`,
      });
    }
  }
}

function validateSelect(
  field: Extract<InputField, { type: 'select' }>,
  value: unknown,
  errors: ValidationError[],
): void {
  if (typeof value !== 'string') {
    errors.push({ field: field.key, message: `${field.label} must be a string.` });
    return;
  }
  const allowed = field.options.map((o) => o.value);
  if (!allowed.includes(value)) {
    errors.push({
      field: field.key,
      message: `${field.label} must be one of: ${allowed.join(', ')}.`,
    });
  }
}

function validateMultiselect(
  field: Extract<InputField, { type: 'multiselect' }>,
  value: unknown,
  errors: ValidationError[],
): void {
  if (!Array.isArray(value)) {
    errors.push({ field: field.key, message: `${field.label} must be an array.` });
    return;
  }
  const allowed = new Set(field.options.map((o) => o.value));
  const invalid = value.filter((v) => typeof v !== 'string' || !allowed.has(v));
  if (invalid.length > 0) {
    errors.push({
      field: field.key,
      message: `${field.label} contains invalid value(s): ${invalid.join(', ')}.`,
    });
  }
}

/**
 * Produce the template context: the validated config with manifest defaults
 * filled in for any omitted field. Call only after `validateConfig` passes.
 */
export function applyDefaults(
  config: Record<string, unknown>,
  schema: InputSchema,
): ResolvedConfig {
  const resolved: ResolvedConfig = {};

  for (const field of schema.fields) {
    const value = config[field.key];

    if (!isMissing(value)) {
      resolved[field.key] = value;
      continue;
    }

    switch (field.type) {
      case 'string':
        resolved[field.key] = field.default ?? '';
        break;
      case 'boolean':
        resolved[field.key] = field.default ?? false;
        break;
      case 'select':
        resolved[field.key] = field.default ?? '';
        break;
      case 'multiselect':
        resolved[field.key] = field.default ?? [];
        break;
    }
  }

  return resolved;
}
