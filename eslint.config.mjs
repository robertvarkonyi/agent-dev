// Lapos (flat) ESLint konfiguráció a monorepóhoz. Szándékosan „recommended" szint,
// típus-ellenőrzés nélkül (a típusokat az `nx typecheck` fedi) — gyors és zajmentes.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out-tsc/**',
      '**/node_modules/**',
      '.nx/**',
      'logs/**',
      'tmp/**',
      'packages/db/prisma/**', // generált/seed adat — nem lintel
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // A tesztek Vitest-globálok nélkül, explicit importtal futnak — nincs külön szabály.
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
