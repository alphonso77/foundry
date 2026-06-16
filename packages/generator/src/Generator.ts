import JSZip from 'jszip';
import type { BlueprintManifest, BlueprintResolver } from '@foundry/shared';
import { ConfigValidationError } from './errors.js';
import { createHandlebars } from './helpers.js';
import { applyDefaults, validateConfig } from './validation.js';

/** A single emitted file: output path (`.hbs` already stripped) + final bytes. */
export interface GeneratedFile {
  path: string;
  contents: string;
}

export interface GenerateResult {
  manifest: BlueprintManifest;
  /** The validated config with defaults applied (the template context used). */
  config: Record<string, unknown>;
  files: GeneratedFile[];
  /** Bundle the emitted files into an in-memory zip (nodebuffer). */
  toZip(): Promise<Buffer>;
}

const HBS_SUFFIX = '.hbs';

/**
 * The generator turns a blueprint + config into an emitted project. It depends
 * ONLY on a BlueprintResolver (ports-and-adapters) — it never touches the
 * filesystem layout or knows where blueprints live.
 *
 * Pipeline: getManifest → validate config → getFiles → render each file with
 * Handlebars (`.hbs` templated + suffix stripped; non-`.hbs` copied verbatim).
 */
export class Generator {
  constructor(private readonly resolver: BlueprintResolver) {}

  async generate(
    blueprintId: string,
    config: Record<string, unknown>,
    version?: string,
  ): Promise<GenerateResult> {
    const manifest = await this.resolver.getManifest(blueprintId, version);

    // Apply defaults FIRST, then validate the resolved config. `required` means
    // "must have a value after defaults are applied", so a field carrying a
    // `default` always satisfies `required`. A required field with no default,
    // when omitted, resolves to '' (still "missing") and correctly fails.
    const resolved = applyDefaults(config, manifest.inputs);
    const errors = validateConfig(resolved, manifest.inputs);
    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }

    const sourceFiles = await this.resolver.getFiles(blueprintId, version);
    const hb = createHandlebars();

    const files: GeneratedFile[] = sourceFiles.map((file) => {
      if (file.path.endsWith(HBS_SUFFIX)) {
        const template = hb.compile(file.contents, { noEscape: true });
        return {
          path: file.path.slice(0, -HBS_SUFFIX.length),
          contents: template(resolved),
        };
      }
      // Non-`.hbs` files are copied verbatim — never run through Handlebars.
      return { path: file.path, contents: file.contents };
    });

    return {
      manifest,
      config: resolved,
      files,
      toZip: () => zipFiles(files),
    };
  }
}

async function zipFiles(files: GeneratedFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.contents);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
