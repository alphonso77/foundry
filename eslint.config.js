// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // CRITICAL: blueprints/** is template payload (contains {{handlebars}} +
    // intentionally-invalid TS). Foundry's own lint must never touch it.
    // node_modules / build output / generated zips are likewise out of scope.
    // .scratch/** is the gen-and-run harness's generated output (generated
    // projects, not Foundry source) — same rationale as blueprints/**.
    ignores: [
      'blueprints/**',
      '.scratch/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.zip',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
