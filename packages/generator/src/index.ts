/**
 * @foundry/generator — the engine that turns a blueprint + config into an
 * emitted project (and a zip). Storage-agnostic: it depends only on a
 * BlueprintResolver.
 */
export { Generator } from './Generator.js';
export type { GeneratedFile, GenerateResult } from './Generator.js';
export { FolderResolver } from './FolderResolver.js';
export { BlueprintNotFoundError, ConfigValidationError } from './errors.js';
export { validateConfig, applyDefaults } from './validation.js';
export type { ResolvedConfig } from './validation.js';
export { createHandlebars, kebabCase, pascalCase, camelCase } from './helpers.js';
