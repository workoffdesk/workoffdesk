// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'ios/*', 'android/*'] },
  // A file past 400 lines does more than one thing: it is split by what each part does.
  { files: ['src/**/*.{ts,tsx}'], rules: { 'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }] } },
]);
