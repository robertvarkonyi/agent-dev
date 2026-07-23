// Lapos (flat) ESLint konfiguráció a monorepóhoz. Szándékosan „recommended" szint,
// típus-ellenőrzés nélkül (a típusokat az `nx typecheck` fedi) — gyors és zajmentes.
import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
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
    // Olvashatóság: struktúra-alapú üres sorok + kötelező kapcsos zárójelek. Ezek
    // NEM ütköznek a Prettierrel (az nem kezel statement-közti üres sort vagy braces-t),
    // ezért `eslint-config-prettier` sem kell. A szemantikus csoportosítás kézi marad —
    // a formázó csak a strukturális térközt garantálja (return elé, blokkok köré stb.).
    plugins: { '@stylistic': stylistic },
    rules: {
      // Minden vezérlési szerkezet kapcsos zárójellel (a braces-nélküli egysoros if-ek
      // ellen — pl. hosszú távon karbantarthatóbb és nehezebb elrontani).
      curly: ['error', 'all'],

      // Osztálytagok közé üres sor (kivéve egysoros tagok után).
      '@stylistic/lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true },
      ],

      // Strukturális üres sorok a logikai blokkok közé. Auto-fixolható.
      '@stylistic/padding-line-between-statements': [
        'error',
        // import-blokk után üres sor (importok között nem).
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },

        // `return` / `continue` / `break` elé üres sor.
        {
          blankLine: 'always',
          prev: '*',
          next: ['return', 'continue', 'break'],
        },

        // Többsoros blokkok (for/if/while/switch/try) köré üres sor.
        { blankLine: 'always', prev: 'multiline-block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'multiline-block-like' },

        // Többsoros const/let deklaráció után üres sor.
        {
          blankLine: 'always',
          prev: ['multiline-const', 'multiline-let'],
          next: '*',
        },

        // Függvény-/osztálydeklarációk köré üres sor.
        { blankLine: 'always', prev: '*', next: ['function', 'class'] },
        { blankLine: 'always', prev: ['function', 'class'], next: '*' },
      ],
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
