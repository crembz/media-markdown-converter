import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Intentionally narrow. The goal is to catch the classes of bug this codebase
// has actually hit — stale/missing hook dependencies, unused code, floating
// promises — not to impose a formatting standard on 5k lines retroactively.
export default tseslint.config(
  {
    // Build output, vendored assets, and the agent-driver tooling under
    // .claude — none of it is app source.
    ignores: ['dist/**', 'dist-electron/**', 'dist-cli/**', 'node_modules/**', 'public/**', '.tmp-release/**', 'scripts/**', '.claude/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TypeScript already resolves identifiers, and this rule has no globals
      // configured for the browser/Node/Electron mix these files span.
      'no-undef': 'off',
      // Surfaced as warnings: the existing dependency arrays are deliberate in
      // places (refs read at call time), so this is guidance, not a gate.
      'react-hooks/exhaustive-deps': 'warn',
      // Two components sync props into local state on mount (ConfigPanel
      // seeding its form from the saved config, ImagePreview resetting zoom
      // when the image changes). Both are the prop-to-state pattern the rule
      // warns about; rewriting them around `key` remounts is a behavioural
      // change, so this stays advisory until that is done deliberately.
      'react-hooks/set-state-in-effect': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
