import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  BlueprintFile,
  BlueprintManifest,
  BlueprintResolver,
  BlueprintSummary,
} from '@foundry/shared';
import { BlueprintNotFoundError } from './errors.js';

/**
 * Folder-backed BlueprintResolver. Reads `<rootDir>/<id>/blueprint.json` plus
 * the files it lists from `<rootDir>/<id>/template/`.
 *
 * Versioning belongs to the resolver, not the generator: this backend stores a
 * single version per folder, so `version` is accepted and ignored.
 */
export class FolderResolver implements BlueprintResolver {
  constructor(private readonly rootDir: string) {}

  async list(): Promise<BlueprintSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      // No blueprints directory yet → no blueprints.
      return [];
    }

    const summaries: BlueprintSummary[] = [];
    for (const entry of entries) {
      const manifestPath = path.join(this.rootDir, entry, 'blueprint.json');
      try {
        const manifest = await this.readManifest(manifestPath);
        summaries.push({
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
        });
      } catch {
        // Skip non-blueprint directories / unreadable manifests.
      }
    }

    summaries.sort((a, b) => a.name.localeCompare(b.name));
    return summaries;
  }

  async getManifest(id: string, _version?: string): Promise<BlueprintManifest> {
    const manifestPath = path.join(this.rootDir, id, 'blueprint.json');
    try {
      return await this.readManifest(manifestPath);
    } catch {
      throw new BlueprintNotFoundError(id, _version);
    }
  }

  async getFiles(id: string, version?: string): Promise<BlueprintFile[]> {
    const manifest = await this.getManifest(id, version);
    const templateDir = path.join(this.rootDir, id, 'template');

    const files: BlueprintFile[] = [];
    for (const relPath of manifest.files) {
      const abs = path.join(templateDir, relPath);
      // Read as utf-8 — template payloads are text. The `.hbs` suffix (if any)
      // is preserved on `path`; the generator strips it when emitting.
      const contents = await readFile(abs, 'utf-8');
      files.push({ path: relPath, contents });
    }
    return files;
  }

  private async readManifest(manifestPath: string): Promise<BlueprintManifest> {
    const info = await stat(manifestPath);
    if (!info.isFile()) {
      throw new Error(`Not a file: ${manifestPath}`);
    }
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as BlueprintManifest;
  }
}
