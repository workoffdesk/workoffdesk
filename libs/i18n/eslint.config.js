import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // A file past 400 lines does more than one thing: it is split by what each part does.
  { files: ['src/**/*.ts'], rules: { 'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }] } },
);
