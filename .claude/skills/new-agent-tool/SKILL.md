---
name: new-agent-tool
description: >-
  Scaffold egy új agent-toolt a Plantbase askAgent tool-regiszterébe, a repó
  meglévő mintája szerint (runSql, listCategories). Használd, amikor a
  felhasználó új képességet akar adni az agentnek — pl. "adj egy X toolt az
  agentnek", "az agent tudjon Y-t is", "csinálj egy tool-t ami Z-t csinál",
  vagy amikor egy új natural-language kérdésfajtát dedikált toollal (nem nyers
  SQL-lel) akartok kiszolgálni. Akkor is hívd, ha a felhasználó nem mondja ki a
  "tool" szót, de az agent új adat-képességéről van szó.
---

# Új agent-tool hozzáadása (Plantbase)

A Plantbase agent egy kézzel írt, többlépéses tool-use loop
([ask-agent.ts](../../../packages/core/src/lib/ask-agent.ts)), amely a
**tool-regiszterből** ([tools/registry.ts](../../../packages/core/src/lib/tools/registry.ts))
dolgozik: a `TOOLS` map minden bejegyzése egy `AgentTool` (definíció + handler).
A loop név szerint megkeresi a hívott toolt a regiszterben és lefuttatja — **a
loopot új toolhoz nem kell módosítani**. Egy tool hozzáadása így **4 lépés**
(+ opcionális export), és a leggyakoribb hiba (a system prompt kifelejtése)
ellen ez a skill végigviszi mindet.

A minta a `listCategories` toolból olvasható ki — ha bizonytalan vagy, nézd meg
élőben: [tools/list-categories.ts](../../../packages/core/src/lib/tools/list-categories.ts),
[tools/list-categories.spec.ts](../../../packages/core/src/lib/tools/list-categories.spec.ts),
és a regiszter-bejegyzését a [tools/registry.ts](../../../packages/core/src/lib/tools/registry.ts)-ben.

## Előfeltétel: tisztázd a tool szerződését

Mielőtt kódot írsz, legyen egyértelmű (kérdezz vissza, ha hiányzik):

- **Név** (`camelCase`, ige-szerű, pl. `findCheapest`, `plantDetails`).
- **Input**: van-e paramétere? Ha nincs (mint `listCategories`), üres
  `properties`. Ha van, minden mező JSON Schema-ban, `required` listával.
- **Mit ad vissza** és milyen alakban (a modellhez `JSON.stringify`-olva megy).
- **Kell-e új SQL?** Ha egy fix lekérdezésről van szó, tedd exportált
  konstansba (mint `CATEGORIES_SQL`), és **hasznosítsd újra a `runSql`-t** —
  így ingyen kapod a SELECT-guardot + read-only role védelmet. Ne nyiss új
  DB-kapcsolatot.
- **Mikor hívja a modell** (ez megy a system promptba).

## TDD: piros → zöld → refaktor

A repó konvenciója a test-first
([konvenciok.md](../../../docs/konvenciok.md)). Az agent-loopot nem teszteljük
unit szinten (az LLM-et hív), de a tool **tiszta, determinista magját** igen —
pontosan úgy, ahogy a `list-categories.spec.ts` az `extractCategories`-t
teszteli, nem a `listCategories` DB-hívást. Előbb írd meg a bukó tesztet a
kinyerő/transzformáló függvényre, aztán az implementációt.

## A 4 lépés

### 1. Implementációs fájl — `packages/core/src/lib/tools/<tool-név>.ts`

- Fájlnév `kebab-case`, a `tools/` mappában. Egy fájl egy felelősség.
- A DB-ből jövő sorok típusa `unknown[]` — **soha ne bízz bennük**. A kinyerést
  külön, exportált, tiszta függvénybe tedd (defenzív, fail-soft, sosem dob),
  hogy tesztelhető legyen. Minta: `extractCategories`.
- Ha van user-input paraméter: **`zod`-dal validáld a rendszer-határon**,
  fail-fast, beszédes magyar hibaüzenettel (mint `assertSelectOnly` a
  [tools/run-sql.ts](../../../packages/core/src/lib/tools/run-sql.ts)-ben).
- Fix SQL → exportált `UPPER_SNAKE` konstans, és `runSql`-en keresztül futtasd.
- Magyar kommentek, `singleQuote`, `strict` TS, explicit típus a publikus API-n.
- Relatív importok `.js` kiterjesztéssel (ESM/nodenext), a `.spec.ts`-ben is.

### 2. Teszt — `packages/core/src/lib/tools/<tool-név>.spec.ts`

- `vitest`, explicit importtal: `import { describe, it, expect } from 'vitest'`
  (nincs global), a tiszta kinyerő/validáló függvényre.
- Magyar, beszédes tesztnevek ("... amikor ..."). Fedd le: happy path, dedup /
  edge, hibás/hiányzó mező, üres bemenet.
- Futtasd zöldre (lásd Verifikáció).

### 3. Regisztráció — `tools/registry.ts`

Ez az EGYETLEN hely, ahol a toolt „bekötöd" — a loopot nem érinted. Vegyél fel
egy `AgentTool` bejegyzést (definíció + handler) a `TOOLS` mapbe; a
`toolDefinitions` és a loop automatikusan felveszi.

```ts
import { findCheapest, FIND_CHEAPEST_SQL } from './find-cheapest.js';

const findCheapestTool: AgentTool = {
  definition: {
    name: 'findCheapest',
    // A description mondja meg a modellnek, MIT csinál és MIKOR hívja:
    description:
      'A legolcsóbb N termék egy kategóriában. Akkor hívd, ha a felhasználó a legolcsóbbra kérdez.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'A kategória neve.' },
      },
      required: ['category'],
    },
  },
  // A handler visszaadja a naplózandó SQL-t és a modellnek visszafűzendő sorokat.
  // A hibát NE itt kezeld: az agent-loop try/catch-eli és is_error tool_result-ot ad.
  run: async (input) => {
    const rows = await findCheapest((input as { category?: unknown }).category);
    return { sql: FIND_CHEAPEST_SQL, rows };
  },
};

export const TOOLS: Record<string, AgentTool> = {
  [runSqlTool.definition.name]: runSqlTool,
  [listCategoriesTool.definition.name]: listCategoriesTool,
  [findCheapestTool.definition.name]: findCheapestTool, // ← az új sor
};
```

### 4. System prompt — `system-prompt.ts`

A `<tools>` blokkba egy sor az új toolról: mit ad vissza és **pontosan mikor**
hívja (a modell ebből dönt). Ez a lépés a leggyakrabban felejtődik ki — enélkül
a tool ott van, de a modell nem tudja használni.

Ha a tool új domain-fogalmat vagy szabályt hoz, a `<rules>` / `<schema>` blokkot
is frissítsd.

### (opcionális) 5. Export — `index.ts`

Ha a tool tiszta függvényeit a `@plantbase/core` csomagon kívülről is hívni kell
(CLI, teszt), vedd fel a [index.ts](../../../packages/core/src/index.ts)
`export *`-jai közé (a `tools/<tool-név>.js` útról).

## Verifikáció (mindig futtasd a végén)

Node 22 kell (a repó `.nvmrc`-je), a harness shell alapból node 20-at ad:

```bash
nvm use 22
pnpm vitest related --run packages/core/src/lib/tools/<tool-név>.spec.ts   # a friss teszt zöld
pnpm nx typecheck core                                                     # a regiszter típushelyes
pnpm lint                                                                  # ESLint zöld
```

Csak akkor jelentsd késznek, ha mind zöld. A commit külön lépés (a felhasználó
kérésére) — Conventional Commits, feature branch main-ről, egy koherens lépés =
egy commit ([dev-workflow.md](../../../docs/dev-workflow.md)).
