# listCategories tool — design

> Új agent-tool, amely a katalógus **egyedi (distinct) kategóriáit** listázza ki, ha a felhasználó
> rákérdez (pl. „milyen kategóriák vannak?"). Második tool a `runSql` mellett, ugyanabban a
> többlépéses tool-use loopban.

## Cél és hatókör

- **Cél:** a modell egy dedikált `listCategories` toollal le tudja kérni a `products.category`
  mező egyedi, rendezett értékeit, tetszőleges SQL generálása nélkül.
- **Kimenet:** csak a kategórianevek (distinct, ábécé szerint rendezve). Darabszám / egyéb aggregáció
  most **nincs** (YAGNI — a feladat egyedi kategórialistát kér).
- **Nincs input:** a tool paraméter nélküli; mindig a teljes distinct listát adja.

## Architektúra

Az `run-sql.ts` mintáját követi: pure, unit-tesztelhető logika külön `kebab-case` fájlban, a
tool-mechanika az `ask-agent.ts` loopjában marad látható.

### Új fájl: `packages/core/src/lib/list-categories.ts`

- `CATEGORIES_SQL` konstans (`UPPER_SNAKE`):
  `SELECT DISTINCT category FROM products ORDER BY category`
- `extractCategories(rows: unknown[]): string[]` — a **pure, tesztelhető egység**. A sorokból
  kinyeri a `category` string mezőt, kiszűri a nem-string / üres értékeket, és defenzíven dedupál.
  (Ez a `list-categories.ts`-hez az, ami az `assertSelectOnly` a `run-sql.ts`-hez.)
- `listCategories(): Promise<string[]>` — meghívja a `runSql(CATEGORIES_SQL)`-t (újrahasznosítva a
  read-only pool-t és a SELECT-guardot), majd a `result.rows`-t átengedi az `extractCategories`-en.

Az `extractCategories` bemenete megbízhatatlan (DB-ből jövő, majd `unknown[]`-ként kezelt adat):
a rendszer-határon szűkítjük típusra, `any` nélkül.

### Wire-up: `packages/core/src/lib/ask-agent.ts`

- Új `LIST_CATEGORIES_TOOL: Anthropic.Tool` definíció. `input_schema`: `type: 'object'`, üres
  `properties`, nincs `required` (a tool paraméter nélküli).
- Bekerül a `tools: [RUN_SQL_TOOL, LIST_CATEGORIES_TOOL]` tömbbe.
- A tool-dispatch loopban a `block.name === 'listCategories'` ág a `runSql` mellett: meghívja a
  `listCategories()`-t, a kategória-tömböt `JSON.stringify`-jal `tool_result`-ként visszafűzi.
  Ugyanaz a `try/catch` hibaforma, mint a `runSql`-nél (`is_error: true` hibánál).
- Napló-konzisztencia: a `CATEGORIES_SQL` bekerül az `executedSql`-be, a kategórialista pedig a
  `sqlResults`-be, hogy a `logInteraction` tükrözze a lefutott tool-hívást.

### System prompt: `packages/core/src/lib/system-prompt.ts`

- A `<tools>` szekcióba egy sor: `listCategories()` — a katalógus egyedi kategóriáit adja vissza;
  akkor hívd, ha a felhasználó a kategóriákra kérdez rá (ne generálj hozzá SQL-t).

## Adatfolyam

1. Felhasználó: „milyen kategóriák vannak?" → `askAgent(input)`.
2. Modell `tool_use`-t ad `listCategories` névvel (input nélkül).
3. Loop: `listCategories()` → `runSql(CATEGORIES_SQL)` a read-only pool-on → `extractCategories(rows)`.
4. A kategórialista `tool_result`-ként visszamegy a modellnek.
5. Modell természetes nyelvű, magyar választ ad a listából (`stop_reason !== 'tool_use'`).

## Hibakezelés

- Az `extractCategories` sosem dob a rossz alakú sorokra: kiszűri és továbbmegy (fail-soft a
  megbízhatatlan DB-alakra), üres bemenetre `[]`.
- A DB-/kapcsolati hibák a `runSql`-ből propagálnak; a loop `try/catch`-e `is_error` tool_result-ként
  adja vissza a modellnek (ugyanúgy, mint a `runSql` hibáknál).

## Tesztelés (TDD — piros előbb)

- **Unit — `extractCategories`** (`list-categories.spec.ts`, nem kell DB, fut az Edit-hook
  `vitest related`-jén):
  - kinyeri és megőrzi a kategórianeveket a sorokból;
  - kiszűri a nem-string / hiányzó `category` mezőt;
  - defenzíven dedupál;
  - üres sorlistára `[]`.
- A `listCategories()` / loop-wiring DB-kötött útját — az `assertSelectOnly` / `runSql`
  mintájához igazodva — a pure unit fedi; a DB-integráció nincs külön unit-tesztelve ebben a repóban.

## Workflow

- Branch: `feat/list-categories-tool` (main-ről). Kicsi, fókuszált Conventional Commit-ok.
- Node 22 (`nvm use 22`) a pnpm/nx előtt.
