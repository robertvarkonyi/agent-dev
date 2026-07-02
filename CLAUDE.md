# CLAUDE.md — Plantbase

Növény-katalógus feletti, magyar nyelvű **NL→SQL AI agent** (CLI). A felhasználó
természetes nyelven kérdez, az agent SQL-re fordítja, **read-only** lefuttatja a
`products` táblán, és a sorokból természetes nyelvű választ ad.

## Toolchain (kötelező)

- **Node 22 LTS.** Bármilyen `pnpm` / `nx` parancs előtt: `nvm use 22` (a repó
  `.nvmrc`-je 22; a shell alapból 20-at adhat).
- Csomagkezelő: **pnpm** (workspace). Build/task: **Nx**.

## Gyakori parancsok

```bash
pnpm vitest run          # tesztek
pnpm nx typecheck core   # típusellenőrzés (a mag)
pnpm cli ask "..."       # egyszeri kérdés
pnpm cli chat            # interaktív mód
pnpm prettier --write .  # formázás
```

## Architektúra (röviden — részletek: docs/architektura.md)

- `packages/core` — **framework-agnosztikus** agent-mag. Nem ismeri a belépési
  pontokat (CLI/API/web). Új felület = új app, nem újraírás.
- `packages/db` — Prisma lib (séma, migráció, seed). Az agent **NEM** Prismán kérdez.
- `apps/cli` — CLI belépési pont (commander + node:readline).

Kulcsfájlok: [ask-agent.ts](packages/core/src/lib/ask-agent.ts) (tool-use loop),
[tools/registry.ts](packages/core/src/lib/tools/registry.ts) (tool-regiszter),
[tools/run-sql.ts](packages/core/src/lib/tools/run-sql.ts) (SELECT-guard),
[system-prompt.ts](packages/core/src/lib/system-prompt.ts).

## Konvenciók (részletek: docs/konvenciok.md)

- **Két DB-kapcsolat, két jog.** Az agent `runSql`-je READ-ONLY kapcsolaton fut
  (`DATABASE_URL_READONLY`), csak SELECT. A Prisma read-write (`DATABASE_URL`)
  viszi a sémát/migrációt/seedet. Ezt a határt SOHA ne mosd össze.
- **Validálj a rendszer-határon, fail-fast.** Megbízhatatlan bemenet (user input,
  DB-sor, tool-input) → Zod / explicit guard a belépésnél, beszédes hibaüzenettel.
- **ESM + nodenext.** A relatív importok `.js` kiterjesztéssel (a `.spec.ts`-ekben is).
- **Új agent-tool** = egy bejegyzés a [tools/registry.ts](packages/core/src/lib/tools/registry.ts)
  `TOOLS` mapjébe (definíció + handler) — a loopot ne módosítsd. A system promptot
  is frissítsd. Erre való a `new-agent-tool` skill.
- **Tesztek:** Vitest, `import { describe, it, expect } from 'vitest'` (nincs global),
  magyar leírások, FS-tesztek `mkdtempSync`-kel izolálva.
- Minden interakció JSONL-be naplózva a `logs/` alá (napi fájl).

## Git

- **Mindig `main`-ről ágazz, soha ne commitolj közvetlenül `main`-re.** PR-en át.
- Munkafolyamat részletei: docs/dev-workflow.md.

## Custom skillek (.claude/skills/)

- `new-agent-tool` — új tool scaffoldolása az agent loopjába (5 lépés).
- `agent-eval` — regressziós kiértékelés golden kérdéskészlettel.
