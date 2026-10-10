import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// A zone per folder: it may not import the folders above it, nor those beside it on its line.
function layerZones(order) {
  return order.flatMap((line, i) =>
    line.flatMap((folder) =>
      [...order.slice(0, i).flat(), ...line.filter((f) => f !== folder)].map((other) => ({
        target: `./src/${folder}`,
        from: `./src/${other}`,
        message: `src/${folder} sits below src/${other}; see docs/architecture.md.`,
      })),
    ),
  );
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // The server's layers, top to bottom: a folder imports only from the folders below it (docs/architecture.md).
  {
    files: ['src/**/*.ts'],
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: layerZones([
            ['cli.ts'],
            ['commands'],
            ['http'],
            ['sessions'],
            ['ops'],
            ['journal', 'notify', 'uploads', 'ios-update'],
            ['agents'],
            ['system'],
          ]),
        },
      ],
    },
  },
  // A server file past 400 lines does more than one thing: it is split by what each part does.
  { files: ['src/**/*.ts'], rules: { 'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }] } },
  // Plain-JS scripts and fixtures run under node, outside the TypeScript build.
  { files: ['**/*.mjs', '*.js'], languageOptions: { globals: globals.node } },
  // Tests poke at untyped JSON and ws payloads; the app code does not get this.
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  // Fixtures and tests read terminal output, where the escape character is the thing being matched.
  { files: ['tests/**'], rules: { 'no-control-regex': 'off' } },
);
