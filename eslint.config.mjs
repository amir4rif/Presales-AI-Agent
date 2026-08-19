import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      // Existing pages intentionally hydrate browser-owned seed data after mount.
      // Removing this exception requires a broader server-state refactor.
      'react-hooks/set-state-in-effect': 'off',
      // Pipeline projections use the current date as their display baseline.
      'react-hooks/purity': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    'tmp/**',
    '.agents/**',
    '.codex/**',
    'next-env.d.ts',
  ]),
]);
