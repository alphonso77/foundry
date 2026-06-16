import Handlebars from 'handlebars';

/**
 * Split an arbitrary string into its constituent words, handling camelCase /
 * PascalCase boundaries and any run of non-alphanumeric separators.
 */
function words(input: unknown): string[] {
  return String(input ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function kebabCase(input: unknown): string {
  return words(input)
    .map((w) => w.toLowerCase())
    .join('-');
}

export function pascalCase(input: unknown): string {
  return words(input).map(cap).join('');
}

export function camelCase(input: unknown): string {
  const parts = words(input);
  if (parts.length === 0) return '';
  return parts[0]!.toLowerCase() + parts.slice(1).map(cap).join('');
}

/**
 * Create a Handlebars environment with EXACTLY the five helpers fixed by the
 * contract. Blueprint templates may use only these — generator and blueprint
 * must agree (see coordination.md "Generator template-context contract").
 *
 * A fresh isolated instance is used so helper registration never leaks into
 * the global Handlebars singleton across generations.
 */
export function createHandlebars(): typeof Handlebars {
  const hb = Handlebars.create();

  hb.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options) {
    return a === b ? options.fn(this) : options.inverse(this);
  });

  hb.registerHelper('ifIncludes', function (this: unknown, arr: unknown, value: unknown, options) {
    const found = Array.isArray(arr) && arr.includes(value);
    return found ? options.fn(this) : options.inverse(this);
  });

  hb.registerHelper('kebabCase', (input: unknown) => kebabCase(input));
  hb.registerHelper('pascalCase', (input: unknown) => pascalCase(input));
  hb.registerHelper('camelCase', (input: unknown) => camelCase(input));

  return hb;
}
