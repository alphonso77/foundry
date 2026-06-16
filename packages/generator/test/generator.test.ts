import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  BlueprintNotFoundError,
  ConfigValidationError,
  FolderResolver,
  Generator,
  camelCase,
  kebabCase,
  pascalCase,
} from '../src/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'blueprints');

function newGenerator(): Generator {
  return new Generator(new FolderResolver(FIXTURES));
}

function findFile(files: { path: string; contents: string }[], p: string) {
  const f = files.find((file) => file.path === p);
  if (!f) throw new Error(`expected file ${p}; got ${files.map((x) => x.path).join(', ')}`);
  return f;
}

describe('FolderResolver', () => {
  it('lists blueprints from manifests', async () => {
    const resolver = new FolderResolver(FIXTURES);
    const list = await resolver.list();
    expect(list).toEqual([{ id: 'demo', name: 'Demo Blueprint', description: expect.any(String) }]);
  });

  it('returns a manifest', async () => {
    const resolver = new FolderResolver(FIXTURES);
    const manifest = await resolver.getManifest('demo');
    expect(manifest.id).toBe('demo');
    expect(manifest.inputs.fields).toHaveLength(5);
    expect(manifest.files).toContain('README.md.hbs');
  });

  it('returns files with the .hbs suffix intact', async () => {
    const resolver = new FolderResolver(FIXTURES);
    const files = await resolver.getFiles('demo');
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['README.md.hbs', 'src/config.ts.hbs', 'static.txt']);
  });

  it('throws BlueprintNotFoundError for unknown ids', async () => {
    const resolver = new FolderResolver(FIXTURES);
    await expect(resolver.getManifest('nope')).rejects.toBeInstanceOf(BlueprintNotFoundError);
  });

  it('ignores the version argument (folder backend)', async () => {
    const resolver = new FolderResolver(FIXTURES);
    const a = await resolver.getManifest('demo');
    const b = await resolver.getManifest('demo', '9.9.9');
    expect(a).toEqual(b);
  });
});

describe('Generator — happy path', () => {
  it('renders templates, applies defaults, and strips .hbs', async () => {
    const result = await newGenerator().generate('demo', {
      serviceName: 'my-service',
      tags: ['x'],
    });

    // .hbs stripped on output paths; non-.hbs path unchanged.
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(['README.md', 'src/config.ts', 'static.txt']);

    const readme = findFile(result.files, 'README.md').contents;
    expect(readme).toContain('kebab=my-service');
    expect(readme).toContain('pascal=MyService');
    expect(readme).toContain('camel=myService');
    expect(readme).toContain('MODE_A'); // default mode = "a"
    expect(readme).toContain('HAS_X'); // tags includes "x"
    expect(readme).toContain('enabled=true'); // default boolean

    const cfg = findFile(result.files, 'src/config.ts').contents;
    expect(cfg).toContain("name: 'my-service'");
    expect(cfg).toContain('enabled: true');
  });

  it('copies non-.hbs files verbatim (no templating)', async () => {
    const result = await newGenerator().generate('demo', { serviceName: 'svc' });
    const stat = findFile(result.files, 'static.txt').contents;
    expect(stat).toContain('{{serviceName}}');
    expect(stat).toContain('{{#ifEquals}}');
  });

  it('takes the else branch of helpers when conditions fail', async () => {
    const result = await newGenerator().generate('demo', {
      serviceName: 'svc',
      mode: 'b',
      tags: ['y'],
    });
    const readme = findFile(result.files, 'README.md').contents;
    expect(readme).toContain('MODE_B');
    expect(readme).toContain('NO_X');
  });

  it('produces a valid zip via toZip()', async () => {
    const result = await newGenerator().generate('demo', { serviceName: 'svc' });
    const buf = await result.toZip();
    expect(Buffer.isBuffer(buf)).toBe(true);

    const reopened = await JSZip.loadAsync(buf);
    const fileNames = Object.values(reopened.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(fileNames).toEqual(['README.md', 'src/config.ts', 'static.txt']);
    const readme = await reopened.file('README.md')!.async('string');
    expect(readme).toContain('# svc');
  });
});

describe('Generator — validation', () => {
  it('rejects a missing required field', async () => {
    const err = await newGenerator()
      .generate('demo', {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect((err as ConfigValidationError).errors).toContainEqual({
      field: 'serviceName',
      message: expect.stringContaining('required'),
    });
  });

  it('accepts a required field that is omitted but carries a default (default lands in output)', async () => {
    // `datastore` is required AND has a default of "postgres"; omitting it must
    // succeed because defaults are resolved before the required check.
    const result = await newGenerator().generate('demo', { serviceName: 'svc' });
    expect(result.config.datastore).toBe('postgres');
  });

  it('still rejects an omitted required field that has no default', async () => {
    // `serviceName` is required with no default → omitting it still fails.
    const err = await newGenerator()
      .generate('demo', { datastore: 'postgres' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect((err as ConfigValidationError).errors).toContainEqual({
      field: 'serviceName',
      message: expect.stringContaining('required'),
    });
  });

  it('rejects a string that fails its pattern', async () => {
    const err = await newGenerator()
      .generate('demo', { serviceName: 'Not Kebab!' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect((err as ConfigValidationError).errors[0]!.field).toBe('serviceName');
  });

  it('rejects a select value outside its options', async () => {
    const err = await newGenerator()
      .generate('demo', { serviceName: 'svc', mode: 'c' })
      .catch((e) => e);
    expect((err as ConfigValidationError).errors).toContainEqual({
      field: 'mode',
      message: expect.stringContaining('one of'),
    });
  });

  it('rejects multiselect values not a subset of options', async () => {
    const err = await newGenerator()
      .generate('demo', { serviceName: 'svc', tags: ['x', 'bogus'] })
      .catch((e) => e);
    expect((err as ConfigValidationError).errors).toContainEqual({
      field: 'tags',
      message: expect.stringContaining('bogus'),
    });
  });

  it('accepts a valid multiselect subset', async () => {
    const result = await newGenerator().generate('demo', {
      serviceName: 'svc',
      tags: ['x', 'z'],
    });
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('rejects a wrong-typed boolean', async () => {
    const err = await newGenerator()
      .generate('demo', { serviceName: 'svc', enabled: 'yes' })
      .catch((e) => e);
    expect((err as ConfigValidationError).errors).toContainEqual({
      field: 'enabled',
      message: expect.stringContaining('boolean'),
    });
  });
});

describe('case helpers', () => {
  it('kebabCase', () => {
    expect(kebabCase('My Service')).toBe('my-service');
    expect(kebabCase('myServiceName')).toBe('my-service-name');
    expect(kebabCase('HTTPServer')).toBe('http-server');
  });
  it('pascalCase', () => {
    expect(pascalCase('my-service')).toBe('MyService');
    expect(pascalCase('my service name')).toBe('MyServiceName');
  });
  it('camelCase', () => {
    expect(camelCase('my-service')).toBe('myService');
    expect(camelCase('My Service Name')).toBe('myServiceName');
  });
});
