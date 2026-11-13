// ESLint: finds bugs and risky patterns (not formatting: that is Prettier's job).
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/src/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Application code: rules that use TypeScript type information,
  // e.g. "a Promise was created but never awaited" (no-floating-promises).
  {
    files: ['apps/*/src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // React rules for the web app
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
