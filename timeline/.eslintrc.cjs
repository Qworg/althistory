/**
 * ESLint configuration for the backend (timeline) package.
 *
 * This package uses ESLint 8 and @typescript-eslint 6, which use the legacy
 * .eslintrc format rather than the flat config used by the frontend package.
 * The config had been missing entirely, so `npm run lint` could not run at all.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.js'],
  rules: {
    // Unused code is a build error via tsc (noUnusedLocals/noUnusedParameters),
    // so the base rule is redundant here and noisy for intentionally-unused args.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    // The codebase uses `any` in places while it migrates; keep it visible but
    // non-blocking so it can be counted and reduced incrementally.
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',
    // Empty catch blocks are intentional in several places (best-effort cleanup).
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: { jest: true },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unused-expressions': 'off',
      },
    },
  ],
};
