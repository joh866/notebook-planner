import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'design', 'data', 'drizzle'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // The service worker runs in its own scope (step 14).
    files: ['src/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // src/core stays pure: no server, web, or database imports.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/server/**', '**/web/**', 'better-sqlite3', 'drizzle-orm*', 'hono*'] }],
    },
  },
);
