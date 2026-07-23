---
name: new-agent-tool
description: >-
  Scaffold egy új agent-toolt a Plantbase agent tool-készletébe
  (`agent-tools.ts`), a repó meglévő mintája szerint (runSql, listCategories).
  Használd, amikor a felhasználó új képességet akar adni az agentnek — pl.
  "adj egy X toolt az agentnek", "az agent tudjon Y-t is", "csinálj egy tool-t
  ami Z-t csinál",
  vagy amikor egy új natural-language kérdésfajtát dedikált toollal (nem nyers
  SQL-lel) akartok kiszolgálni. Akkor is hívd, ha a felhasználó nem mondja ki a
  "tool" szót, de az agent új adat-képességéről van szó.
---

# Új agent-tool hozzáadása (Plantbase)

A Plantbase agent többlépéses tool-use loopját a Vercel AI SDK futtatja
([ask-agent.ts](../../../packages/core/src/lib/ask-agent.ts)); a tool-ok
egyetlen helyen, az
[agent-tools.ts](../../../packages/core/src/lib/agent-tools.ts) `buildTools`
függvényében élnek. Egy tool hozzáadása **mindig ugyanaz a 4 lépés,
ugyanabban a sorrendben**. Ez a skill ezt a mintát viszi végig, hogy ne
maradjon ki egyik hely sem (a leggyakoribb hiba: a toolt bekötöd az
`agent-tools.ts`-be, de a system promptból kimarad, így a modell nem tudja,
mikor hívja).

A minta a `listCategories` toolból lett kiolvasva — ha bizonytalan vagy egy
döntésben, nézd meg élőben, hogyan csinálja:
[list-categories.ts](../../../packages/core/src/lib/list-categories.ts),
[list-categories.spec.ts](../../../packages/core/src/lib/list-categories.spec.ts).

## Előfeltétel: tisztázd a tool szerződését

Mielőtt kódot írsz, legyen egyértelmű (kérdezz vissza, ha hiányzik):

- **Név** (`camelCase`, ige-szerű, pl. `findCheapest`, `plantDetails`).
- **Input**: van-e paramétere? Ha nincs (mint `listCategories`), `inputSchema:
z.object({})`. Ha van, minden mező `zod` sémában (pl. `z.object({ mező:
z.string().describe('...') })`) — ez `zod` séma, nem JSON Schema.
- **Mit ad vissza** és milyen alakban: az `execute` a végleges értéket (pl. a
  `rows`-t) adja vissza — a modellnek küldött szerializálást az AI SDK végzi,
  nem kell kézzel `JSON.stringify`-olni.
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

### 1. Implementációs fájl — `packages/core/src/lib/<tool-név>.ts`

- Fájlnév `kebab-case`. Egy fájl egy felelősség.
- A DB-ből jövő sorok típusa `unknown[]` — **soha ne bízz bennük**. A kinyerést
  külön, exportált, tiszta függvénybe tedd (defenzív, fail-soft, sosem dob),
  hogy tesztelhető legyen. Minta: `extractCategories`.
- Ha van user-input paraméter: **`zod`-dal validáld a rendszer-határon**,
  fail-fast, beszédes magyar hibaüzenettel (mint `assertSelectOnly` a
  [run-sql.ts](../../../packages/core/src/lib/run-sql.ts)-ben).
- Fix SQL → exportált `UPPER_SNAKE` konstans, és `runSql`-en keresztül futtasd.
- Magyar kommentek, `singleQuote`, `strict` TS, explicit típus a publikus API-n.

### 2. Teszt — `packages/core/src/lib/<tool-név>.spec.ts`

- `vitest` (`describe`/`it`/`expect`), a tiszta kinyerő/validáló függvényre.
- Magyar, beszédes tesztnevek ("... amikor ..."). Fedd le: happy path, dedup /
  edge, hibás/hiányzó mező, üres bemenet.
- Futtasd zöldre (lásd Verifikáció).

### 3. Tool bekötése — `agent-tools.ts`

Egy új bejegyzés a `buildTools` által visszaadott objektumba, a meglévők (`runSql`,
`listCategories`) mintájára — AI SDK `tool()` + `zod` `inputSchema` + `execute`:

```ts
findCheapest: tool({
  description:
    'A legolcsóbb N termék egy kategóriában. Akkor hívd, ha a felhasználó a legolcsóbbra kérdez.',
  inputSchema: z.object({
    category: z.string().describe('A kategória neve.'),
  }),
  execute: async ({ category }) => {
    const { sql, rows } = await runSql(
      `SELECT name, COALESCE(sale_price, price) AS ar FROM products WHERE category ILIKE '${category}' ORDER BY ar LIMIT 5`,
    );
    collector.push({ sql, rows });   // a naplózáshoz — MINDIG told be
    return rows;                     // a modellhez csak a rows megy
  },
}),
```

Az `execute` **mindig** told a `{ sql, rows }`-t a `collector`-ba (ez a JSONL-napló forrása),
és a `rows`-t adja vissza a modellnek. A hibát nem kézzel kezeled: az AI SDK a dobott hibát
tool-eredményként adja vissza a modellnek. Nincs külön loop-bekötés — a `buildTools` egy
helye elég (az `askAgent` és a `streamChat` automatikusan megkapja).

### 4. System prompt — `system-prompt.ts`

A `<tools>` blokkba egy sor az új toolról: mit ad vissza és **pontosan mikor**
hívja (a modell ebből dönt). Ez a lépés a leggyakrabban felejtődik ki — enélkül
a tool ott van, de a modell nem tudja használni.

Ha a tool új domain-fogalmat vagy szabályt hoz, a `<rules>` / `<schema>` blokkot
is frissítsd.

### (opcionális) 5. Export — `index.ts`

Ha a toolt a `@plantbase/core` csomagon kívülről is hívni kell (CLI, teszt),
vedd fel a [index.ts](../../../packages/core/src/index.ts) `export *`-jai közé.

## Verifikáció (mindig futtasd a végén)

Node 22 kell (a repó `.nvmrc`-je), a harness shell alapból node 20-at ad:

```bash
nvm use 22
pnpm vitest related --run packages/core/src/lib/<tool-név>.spec.ts   # a friss teszt zöld
pnpm nx typecheck core                                              # a tool-bekötés típushelyes
```

Csak akkor jelentsd késznek, ha mindkettő zöld. A commit külön lépés (a
felhasználó kérésére) — Conventional Commits, feature branch main-ről, egy
koherens lépés = egy commit ([dev-workflow.md](../../../docs/dev-workflow.md)).
