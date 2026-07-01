# Plantbase — implementációs terv (proposal)

> Kurzus-melléklet. A `brs-plantbase.md` (BRS), `stack.md`, `architektura.md`, `konvenciok.md`,
> `dev-workflow.md` és `system-prompt.md` alapján. Ez a terv két nagy részből áll:
> **A) környezet létrehozása** (mérföldkő, futó és tesztelhető projekt), majd
> **B) az implementáció 3 fázisa** rétegről rétegre (echo → LLM → SQL).
>
> Alapelv: minden lépés **kicsi, önállóan tesztelhető increment**, a végén **egy commit**.
> Minden lépés után a fejlesztő **manuálisan tesztel**, mielőtt tovább megyünk.

## Állapot: ✅ KÉSZ (a `main`-en)

A teljes terv megvalósult; a `main`-en fut a működő Plantbase (élő kérdés → helyes SQL →
helyes válasz, read-only garanciával és naplózással). Lépésenként egy commit, fázisonként PR.

| Lépés | Commit | PR |
|---|---|---|
| A1 Nx workspace + pnpm | `9300815` | #2 |
| A2 cli/core/db projektek | `6921435` | #2 |
| A3 Postgres + read-only role | `4d9d949` | #2 |
| A4 Prisma séma + migráció | `abcd276` | #2 |
| A5 seed bekötése (30 növény) | `98e5ebe` | #2 |
| A6 üres CLI belépési pont | `50f911e` | #2 |
| B1 CLI echo | `9ad3ad4` (+teszt `1e82a9f`) | #3 |
| B2 LLM, DB nélkül | `4a826a6` | #4 |
| B3 runSql tool + multistep loop | `658be75` | #5 |

### Főbb eltérések a tervtől (megvalósítás közben)

- **Node 22.17.0 LTS-hez kötve** (`.nvmrc`, `engines`): az Nx 23 által választott Vitest 4 /
  Vite 8 / rolldown toolchain natív bindingje Node ≥ 20.19/22.12-t igényel.
- **Prisma 6.19** (nem 7): a kapott seed klasszikus `new PrismaClient()` + `@prisma/client`
  importot használ; a v7 driver-adaptert követelne + a seed módosítását. Ezért v6 (`url` a
  sémában, `prisma-client-js`, `prisma.config.ts` nélkül).
- **Seed helye:** a kapott `plants.ts` + `seed.ts` a `packages/db/prisma/` alá került, a seed
  parancs a root `package.json` `prisma.seed`-jében; a `/seed` kit-mappa törölve.
- **CLI futtatás:** `pnpm cli ask "..."` (tsx-szel a forrásból, `--conditions`), nem `nx serve`.
- Külön kapott teszt/script nem érkezett a seeden túl; a lefedettséget TDD-vel írt unit +
  CLI integrációs tesztek adják.

## Rögzített döntések (a terv előfeltevései)

- **Assetek kívülről.** A függőségek, a **seed adat**, valamint a **tesztek/scriptek**
  készen érkeznek (kívülről kapjuk). Ezeket a helyükre illesztjük és bekötjük —
  **seedet NEM generálunk újra**.
- **LLM modell:** `claude-sonnet-4-6`, env-ből felülírható (`ANTHROPIC_MODEL` default).
- **runSql driver:** **node-postgres (`pg`)** `Pool`, a `DATABASE_URL_READONLY` kapcsolaton
  (az agent NEM Prismán kérdez — `architektura.md` 2. pont). A Prisma tisztán séma/migráció/seed
  a read-write `DATABASE_URL`-en.
- **Read-only védelem két rétegben:** (1) Postgres **read-only role** a `DATABASE_URL_READONLY`-hoz
  (valódi garancia), (2) kód-szintű **SELECT-guard** (fail-fast, beszédes hiba).
- **Kézzel írt agent-loop.** Az `askAgent` az Anthropic SDK-ra épülő, **saját** tool-use loop,
  agent-framework és `toolRunner` helper nélkül, hogy a mechanika látható maradjon
  (`architektura.md` 3. pont).
- **Stack (a `stack.md` szerint):** TypeScript (strict), Nx, pnpm, Node LTS, PostgreSQL
  (docker-compose, OrbStack), Prisma, Anthropic SDK + saját loop, Zod, commander + `node:readline`,
  Vitest, ESLint + Prettier, tsx. Új, a stack.md-ben nem nevesített futásidejű függőség: **`pg`**
  (a runSql read-only driveréhez).

## Célstruktúra (Nx monorepo)

```
plantbase/
├── packages/core   agent-logika (askAgent loop, runSql tool, schema-context, logger)
├── packages/db     Prisma lib (schema, migráció, kliens, seed) — NEM a gyökérben
├── apps/cli        CLI (ask parancs + interaktív readline mód)
├── docs            dokumentáció
├── docker-compose.yml   lokális Postgres (OrbStack)
└── config          nx.json, package.json, pnpm-workspace.yaml, .env(.example), tsconfig, eslint, prettier
```

Konvenciók: `konvenciok.md` (naming, TS strict, hibakezelés, XML-szerű agent-promptok, fájlszervezés).
Git/commit/hookok: `dev-workflow.md` (feature branch, Conventional Commits, egy lépés = egy commit).

---

# A) Környezet létrehozása (mérföldkő) — ✅ kész

Cél: a mérföldkő végén a projekt **fut és manuálisan tesztelhető** — Nx monorepo
(`packages/core` + `apps/cli`), `packages/db` a Prisma libbel, a **seed betöltve**, és
**egy üres CLI elindul**. A meglévő assetet (seed, tesztek, scriptek) használjuk, nem generáljuk újra.

Ág: `feat/dev-env` (már ezen vagyunk). Minden lépés végén egy fókuszált commit.

### A1 — Nx workspace + pnpm alap

- `create-nx-workspace` integrated monorepo, TypeScript preset, **pnpm** csomagkezelő,
  Nx Cloud kihagyva.
- Gyökér config: `nx.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` (**strict**),
  ESLint + Prettier, Vitest alap.
- `.gitignore` már megvan (Node/pnpm/.env lefedve).

**Manuális teszt (A1):**
- `pnpm install` hibátlan.
- `pnpm nx --version` és `pnpm nx graph` fut (üres graph).

**Commit:** `feat: scaffold nx workspace with pnpm`

### A2 — Projektek generálása (üres, de buildel)

- `apps/cli` — `@nx/node:app` (bundler: **esbuild**, unitTestRunner: **vitest**).
  Belépési pont: `apps/cli/src/main.ts`, egyelőre no-op.
- `packages/core` — `@nx/js:lib` (compiler: tsc, **strict**, vitest), importPath: `@plantbase/core`.
- `packages/db` — `@nx/js:lib` (**strict**, vitest), importPath: `@plantbase/db`.
- Path-aliasok a `tsconfig.base.json`-ben (`@plantbase/core`, `@plantbase/db`).

**Manuális teszt (A2):**
- `pnpm nx run cli:build` sikeres.
- `pnpm nx graph` mutatja a három projektet.
- (Placeholder tesztek zöldek: `pnpm nx run-many -t test`.)

**Commit:** `feat: generate cli app and core/db libs`

### A3 — Postgres (docker-compose, OrbStack) + két kapcsolat

- `docker-compose.yml`: PostgreSQL (aktuális stabil major), lokális port, named volume.
- `.env.example` + `.env` (utóbbi gitignore-olt):
  - `DATABASE_URL` — **read-write** (Prisma: séma/migráció/seed).
  - `DATABASE_URL_READONLY` — **read-only** role (a runSql ezt kapja majd a 3. fázisban).
  - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`) — a B fázisokhoz.
- Init-SQL a read-only role létrehozásához (`plantbase_ro`, `GRANT SELECT`, `USAGE`;
  `DEFAULT PRIVILEGES` a jövőbeli tábláknak) — a `docker-compose` `initdb` mappáján keresztül,
  vagy migráció utáni egyszeri script (a seed/script assetek részeként, ha adott).

**Manuális teszt (A3):**
- `docker compose up -d`, `docker compose ps` → egészséges.
- Kapcsolódás a read-write role-lal (pl. `psql "$DATABASE_URL" -c '\conninfo'`).
- A read-only role-lal `SELECT 1` megy; `CREATE TABLE ...` **elutasítva** (jog hiánya).

**Commit:** `feat: add local postgres via docker-compose with read-only role`

### A4 — Prisma a `packages/db`-ben

> **Doksi előbb (`architektura.md` 7.):** a Prisma API-t Context7-tel beolvastuk. A v7 breaking
> változása (nincs `url` a sémában, kötelező driver-adapter) miatt a **stabil Prisma 6.19**-et
> választottuk, hogy a kapott klasszikus seed módosítás nélkül fusson (lásd az eltérések fentebb).

- `packages/db/prisma/schema.prisma`: `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`,
  `generator client { provider = "prisma-client-js" }` (a kliens a `@prisma/client`-be generál);
  `products` modell a **`stack.md` séma** szerint, **snake_case** mezőkkel + `@@map("products")`.
- Első migráció (root-ból, a `.env`-t a Prisma tölti): `prisma migrate dev --name init --schema packages/db/prisma/schema.prisma`.
- Prisma kliens generálása; a **seed** a `@prisma/client`-ből importál (a runSql viszont NEM
  Prismán, hanem `pg`-vel megy a read-only kapcsolaton).
- Nx target-ek a `packages/db`-hez: `migrate`, `generate`, `seed` (a `db:seed` a következő lépésben
  kapja meg a valódi seed scriptet).

**Manuális teszt (A4):**
- `pnpm nx run db:migrate` lefut, a `products` tábla létrejön.
- `psql "$DATABASE_URL" -c '\d products'` a séma szerinti oszlopokat mutatja.
- `pnpm nx run db:generate` után a kliens típusai importálhatók.

**Commit:** `feat(db): add prisma schema and initial products migration`

### A5 — Seed + tesztek/scriptek beillesztése (kívülről kapott assetek)

- A **megadott** seed fájl(oka)t a `packages/db` alá tesszük (pl. `packages/db/src/seed.ts`
  vagy adott SQL), és bekötjük a `db:seed` targetbe (tsx-szel futtatva, `DATABASE_URL`-en).
  **A seed adatot NEM írjuk újra** — a kapott ~30 növényes, valós fajnevű adatot használjuk.
- A megadott **tesztek/scriptek** a helyükre kerülnek (core/db/cli szerint), a Vitest bekötve.

**Manuális teszt (A5):**
- `pnpm nx run db:seed` → ~30 növény betöltve; `SELECT count(*) FROM products;` egyezik.
- `pnpm nx run-many -t test` → a kapott tesztek zöldek.

**Commit:** `feat(db): wire provided seed and tests`

### A6 — Üres CLI belépési pont (mérföldkő zárása)

- `apps/cli`: `commander` program `plantbase` névvel; `ask <kérdés>` parancs és **interaktív mód**
  (`node:readline`, amíg `exit`) — **váz**, még csak keretstruktúra (a logikát a B1 tölti fel).
- `plantbase` indítható `pnpm nx run cli:serve`-vel; `--help` a parancsokat mutatja.

**Manuális teszt (A6):**
- `pnpm nx run cli:serve -- --help` → látszik az `ask` parancs és az interaktív mód.
- Az interaktív mód elindul és `exit`-re kilép (tartalom nélkül).

**Commit:** `feat(cli): empty plantbase entry point (ask + interactive skeleton)`

> **A) mérföldkő kész:** a projekt fut, a seed betöltve, egy üres CLI elindul és tesztelhető.

---

# B) Implementáció — 3 fázis (ebben a sorrendben) — ✅ kész

A sorrend szándékosan **rétegről rétegre** halad, hogy a működés fokozatosan látszódjon:
**1) CLI echo (LLM nélkül) → 2) LLM (DB nélkül) → 3) SQL-es interakció (runSql tool).**
Minden fázis kicsi, önállóan tesztelhető, a végén egy commit. Ág: `feat/dev-env`-ről
fázisonként fakadhat `feat/<...>` (pl. `feat/cli-echo`), a `dev-workflow.md` szerint.

## 1. fázis — CLI visszhang (echo), LLM nélkül

Cél: a CLI-n keresztül interaktálok, és a program **visszaírja, amit beírtam**. Még nincs LLM,
nincs adatbázis. Ez bizonyítja, hogy a be/kimeneti csővezeték (parancs + interaktív readline) áll.

**Mit építünk:**
- `apps/cli`: az `ask "<szöveg>"` parancs kiírja a szöveget (`echo`), és az interaktív mód
  minden sorra visszaírja azt, amíg `exit`.
- A tiszta echo-logika kis, **tesztelhető** függvényben (pl. `packages/core` `formatEcho`,
  vagy cli-oldali util) — a readline I/O-tól elválasztva (konvenciók: egy fájl egy felelősség).
- Input-validáció a határon (Zod: nem üres szöveg), beszédes hiba.

**Manuális teszt (1. fázis):**
- `pnpm nx run cli:serve -- ask "szia"` → kiírja: `szia` (vagy a definiált echo-formátum).
- Interaktív mód: több sor beírása → mindegyik visszajön; `exit` kilép.
- `pnpm nx test` → az echo unit teszt zöld.

**Commit:** `feat: echo mode without llm`

## 2. fázis — LLM, adatbázis nélkül

Cél: a CLI-t bekötjük egy **sima LLM-hívásba**. Az agent válaszol, de **nincs adatbázis-hozzáférése**,
ezért adatra vonatkozó kérdésnél **őszintén** megmondja, hogy nem fér a DB-hez és nem tud válaszolni.

> **Doksi előbb:** az Anthropic SDK tool-use/loop mechanikáját Context7-tel beolvastuk. Itt még
> **tool nélkül** hívunk (`messages.create`), a **kézzel írt loop vázával**, amit a 3. fázis tölt fel
> tool-use ággal.

**Mit építünk (`packages/core`):**
- `askAgent(question)`: Anthropic SDK kliens (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`),
  **system prompt a `system-prompt.md` alapján** (XML-szerű tagek: `<role>`, `<task>`, `<schema>`,
  `<rules>`, `<behavior>`), egyszeri (single-turn) hívás — **még nincs `runSql` tool megadva**.
  Mivel nincs tool, a modell adat-kérdésnél a `<behavior>`/`<rules>` szerint jelzi, hogy nincs
  DB-hozzáférése.
- **JSONL naplózás (`FR4`)**: `logs/<timestamp>.jsonl` — system prompt, üzenetek, válasz,
  token-felhasználás. Strukturált logger (nincs `console.log` a termékkódban).
- **`--show-prompt` (`FR5`)**: kiírja a teljes üzenet-tömböt.
- A CLI `ask`/interaktív mód mostantól `askAgent`-et hív az echo helyett.

**Manuális teszt (2. fázis):**
- `pnpm nx run cli:serve -- ask "szia, ki vagy?"` → értelmes bemutatkozó válasz.
- `... ask "hány pozsgás van raktáron?"` → az agent **bevallja**, hogy nincs adatbázis-hozzáférése,
  nem talál ki adatot.
- `logs/` alatt keletkezik JSONL a hívásról; `--show-prompt` kiírja a teljes promptot.

**Commit:** `feat: wire askAgent to llm without database access`

## 3. fázis — SQL-es interakció (runSql tool)

Cél: bekötjük a **`runSql` toolt**. Az agent a kérdésből **SQL-t ír**, lefuttatja a katalóguson
(read-only), és **valós, természetes nyelvű** választ ad (`FR2`, `FR3`).

> **Doksi előbb:** a `pg` Pool és a Prisma raw/kliens határok Context7-tel ellenőrizve.

**Mit építünk (`packages/core`):**
- `runSql(query)` tool: **`pg` `Pool`** a `DATABASE_URL_READONLY`-n. **SELECT-guard**
  (kód + Zod): csak `SELECT`/`WITH ... SELECT`, egyetlen utasítás, tiltott kulcsszavak
  (INSERT/UPDATE/DELETE/DDL) elutasítva — fail-fast, beszédes hiba. Paraméterezés/limit a
  konvenciók szerint; a modell a `<rules>` alapján tesz `LIMIT`-et.
- **Read-only garancia két rétegben:** a `pg` a read-only role-lal kapcsolódik (A3), és a
  SELECT-guard a kódban is szűr.
- **Kézzel írt tool-use loop** (`architektura.md` 3.): `messages.create` → ha
  `stop_reason === 'tool_use'`, a `tool_use` blokk `input`-jából kivesszük a queryt, lefuttatjuk
  `runSql`-lel, az eredményt `tool_result`-ként (a `tool_use_id`-vel) visszafűzzük, és **ismételjük**,
  amíg `end_turn` (multistep — `FR2`). **Nem** használjuk a `toolRunner` helpert.
- A `runSql` tool a modellnek megadva (`tools`, `input_schema` a query-re).
- Naplózás kiegészül: **generált SQL + eredmény** is a JSONL-be (`FR4`).

**Manuális teszt (3. fázis):**
- `... ask "mutass 3 olcsó, pet-safe szobanövényt, ami raktáron van"` → helyes SQL fut,
  valós sorok, tömör magyar válasz (ár/akció, raktár, méret kiemelve).
- `... ask "mennyibe kerül a legdrágább kaktusz?"` → helyes aggregált válasz.
- Írási próbálkozás blokkolva: sem a modell nem ír (rules), sem a guard/role nem enged
  (ha mégis próbálná, elutasítva).
- `--show-prompt` és `logs/` mutatja a promptot, a generált SQL-t és az eredményt.
- `pnpm nx test` → a runSql SELECT-guard tesztjei zöldek.

**Commit:** `feat: add read-only runSql tool and multistep agent loop`

> **B) kész:** élő kérdés → helyes SQL → helyes válasz, read-only garanciával és teljes
> naplózással (a BRS 5. sikerkritériumai).

---

## Tesztelési és minőségi elvek (végig)

- **TDD ahol értelmes** (`konvenciok.md`): a SELECT-guard és az echo-logika piros→zöld→refaktor.
- **Szintek:** unit (guard, echo, prompt-építés), integration (Prisma migráció/seed, `pg` runSql
  a lokális DB-n), a kritikus flow-t a manuális fázis-teszt fedi.
- **Determinista, izolált** tesztek; a DB-integrációs teszt a lokális Postgres ellen fut.
- **Minden fázis végén** a fejlesztő manuálisan tesztel, mielőtt a következő lépés indul.

## Kockázatok / nyitott pontok

- **Assetek formátuma.** A kapott seed/teszt/script pontos formátuma (TS seed vs. SQL dump,
  teszt-elrendezés) az A5-nél derül ki; a bekötést ahhoz igazítjuk (seedet nem generálunk).
- **Prisma major.** A pontos Prisma verzió a legfrissebb stabilhoz igazodik (Context7-tel
  ellenőrzött `prisma.config.ts` mintával); ha a generátor/CLI részletek térnek, az A4-nél
  igazítunk.
- **Read-only role init.** A role-t az A3 hozza létre; ha a séma migráció után jönne, a
  `DEFAULT PRIVILEGES`/`GRANT SELECT` időzítését az A4 után is meg kell erősíteni.

---

# C) Bővítés — `listCategories` tool (új feature)

> **Agentikus végrehajtóknak:** ajánlott sub-skill a `superpowers:subagent-driven-development`
> (vagy `superpowers:executing-plans`), task-onként. A lépések checkbox (`- [ ]`) szintaxissal
> követhetők. Spec: `docs/superpowers/specs/2026-07-01-list-categories-tool-design.md`.

**Cél:** egy második, paraméter nélküli agent-tool (`listCategories`), amely a `products.category`
egyedi, ábécésorrendbe rendezett értékeit adja vissza, ha a felhasználó a kategóriákra kérdez rá.

**Megközelítés:** a `run-sql.ts` mintáját követjük — pure, unit-tesztelhető logika külön
`kebab-case` fájlban, a tool-mechanika az `ask-agent.ts` kézzel írt loopjában marad. A lekérdezés a
meglévő `runSql`-t hasznosítja újra (read-only pool + SELECT-guard), nincs új pool.

**Kimenet:** csak a kategórianevek (distinct, rendezett). Darabszám/aggregáció nincs (YAGNI).

Ág: `feat/list-categories-tool` (main-ről). Node 22 (`nvm use 22`) a pnpm előtt. Kis, fókuszált
Conventional Commit-ok.

## Globális megkötések (minden taskra érvényes)

- **Node 22 LTS**: minden pnpm/nx parancs előtt `nvm use 22`.
- **TypeScript strict**; publikus API-n explicit típus. Külső/DB-adat `unknown`, **nem** `any`;
  szűkíts biztonságosan.
- **Fájlnév** `kebab-case`, egy fájl egy felelősség. **Naming**: `camelCase` fv, `PascalCase` típus,
  `UPPER_SNAKE` konstans.
- **Nincs `console.log`** a termékkódban.
- **Az agentnek adott promptok** XML-szerű tagekkel (`<tools>`).

## Fájlszerkezet

- **Létrehoz:** `packages/core/src/lib/list-categories.ts` — `CATEGORIES_SQL`, `extractCategories`
  (pure), `listCategories` (async, `runSql`-t hív).
- **Létrehoz:** `packages/core/src/lib/list-categories.spec.ts` — az `extractCategories` unit-tesztjei.
- **Módosít:** `packages/core/src/lib/ask-agent.ts` — `LIST_CATEGORIES_TOOL` definíció, a `tools`
  tömb bővítése, a tool-dispatch loop `listCategories` ága.
- **Módosít:** `packages/core/src/lib/system-prompt.ts` — `<tools>` szekció bővítése.

---

### C1 — `extractCategories` pure logika (TDD)

**Files:**
- Create: `packages/core/src/lib/list-categories.spec.ts`
- Create: `packages/core/src/lib/list-categories.ts`

**Interfaces:**
- Produces: `CATEGORIES_SQL: string`, `extractCategories(rows: unknown[]): string[]`,
  `listCategories(): Promise<string[]>` (utóbbi implementációja a C2-ben zárul, de a fájl itt jön létre).

- [ ] **1. lépés — Bukó teszt.** `packages/core/src/lib/list-categories.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractCategories } from './list-categories';

describe('extractCategories', () => {
  it('kinyeri és megőrzi a kategórianeveket a sorokból', () => {
    const rows = [{ category: 'kaktusz' }, { category: 'pozsgás' }, { category: 'szobanövény' }];
    expect(extractCategories(rows)).toEqual(['kaktusz', 'pozsgás', 'szobanövény']);
  });

  it('defenzíven dedupál', () => {
    const rows = [{ category: 'kaktusz' }, { category: 'kaktusz' }, { category: 'fűszer' }];
    expect(extractCategories(rows)).toEqual(['kaktusz', 'fűszer']);
  });

  it('kiszűri a nem-string / hiányzó category mezőt', () => {
    const rows = [{ category: 'kaktusz' }, { category: null }, {}, { category: 42 }, { category: '' }];
    expect(extractCategories(rows)).toEqual(['kaktusz']);
  });

  it('üres sorlistára üres tömb', () => {
    expect(extractCategories([])).toEqual([]);
  });
});
```

- [ ] **2. lépés — Futtasd, bukjon.**
  Run: `nvm use 22 && pnpm nx test core -- list-categories`
  Expected: FAIL (`extractCategories is not a function` / nincs `./list-categories` modul).

- [ ] **3. lépés — Minimál implementáció.** `packages/core/src/lib/list-categories.ts`:

```ts
import { runSql } from './run-sql.js';

// A distinct kategóriák lekérdezése (rendezett). A runSql SELECT-guardja + a read-only role védi.
export const CATEGORIES_SQL = 'SELECT DISTINCT category FROM products ORDER BY category';

// A DB-ből jövő sorok megbízhatatlanok (unknown[]): a category string mezőt szűrjük ki,
// a nem-string / üres értéket eldobjuk, és defenzíven dedupálunk. Sosem dob (fail-soft).
export function extractCategories(rows: unknown[]): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const row of rows) {
    const value = (row as { category?: unknown }).category;
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      categories.push(value);
    }
  }
  return categories;
}

// A katalógus egyedi kategóriái. A meglévő runSql-t hasznosítja újra (read-only pool + guard).
export async function listCategories(): Promise<string[]> {
  const result = await runSql(CATEGORIES_SQL);
  return extractCategories(result.rows);
}
```

- [ ] **4. lépés — Futtasd, legyen zöld.**
  Run: `nvm use 22 && pnpm nx test core -- list-categories`
  Expected: PASS (mind a 4 teszt).

- [ ] **5. lépés — Commit.**

```bash
git add packages/core/src/lib/list-categories.ts packages/core/src/lib/list-categories.spec.ts
git commit -m "feat(core): add listCategories with extractCategories guard"
```

---

### C2 — `listCategories` bekötése az agent-loopba

**Files:**
- Modify: `packages/core/src/lib/ask-agent.ts`

**Interfaces:**
- Consumes: `listCategories` a `./list-categories.js`-ből; `CATEGORIES_SQL` a naplózáshoz.

- [ ] **1. lépés — Import kiegészítése.** A `run-sql.js` import mellé, `ask-agent.ts` tetején:

```ts
import { runSql } from './run-sql.js';
import { listCategories, CATEGORIES_SQL } from './list-categories.js';
```

- [ ] **2. lépés — Tool-definíció.** A `RUN_SQL_TOOL` konstans után:

```ts
// A listCategories tool: paraméter nélküli, a katalógus egyedi kategóriáit adja vissza.
const LIST_CATEGORIES_TOOL: Anthropic.Tool = {
  name: 'listCategories',
  description:
    'A katalógus egyedi (distinct) kategóriáinak listája. Akkor hívd, ha a felhasználó a kategóriákra kérdez rá — ne generálj hozzá SQL-t.',
  input_schema: {
    type: 'object',
    properties: {},
  },
};
```

- [ ] **3. lépés — A tool regisztrálása.** A loopon belüli `messages.create({ ... })` hívásban a
  `tools` mezőt bővítsd:

```ts
      tools: [RUN_SQL_TOOL, LIST_CATEGORIES_TOOL],
```

- [ ] **4. lépés — Dispatch-ág a loopban.** A `for (const block of response.content)` cikluson belül,
  a meglévő `runSql` `if` **után** told be a `listCategories` ágat:

```ts
      if (block.type === 'tool_use' && block.name === 'listCategories') {
        try {
          const categories = await listCategories();
          executedSql.push(CATEGORIES_SQL);
          sqlResults.push(categories);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(categories),
          });
        } catch (error) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Hiba: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true,
          });
        }
      }
```

- [ ] **5. lépés — Regressziós ellenőrzés.** A meglévő `ask-agent.spec.ts` (extractText, buildPrompt)
  maradjon zöld:
  Run: `nvm use 22 && pnpm nx test core`
  Expected: PASS (minden core teszt, köztük a C1 és az ask-agent unitok).

- [ ] **6. lépés — Commit.**

```bash
git add packages/core/src/lib/ask-agent.ts
git commit -m "feat(core): wire listCategories into the agent tool loop"
```

---

### C3 — System prompt: a tool ismertetése a modellnek

**Files:**
- Modify: `packages/core/src/lib/system-prompt.ts`

- [ ] **1. lépés — `<tools>` szekció bővítése.** A `<tools>` blokkban a `runSql` sor alá:

```
- listCategories(): a katalógus egyedi kategóriáit adja vissza. Ha a felhasználó a kategóriákra kérdez rá ("milyen kategóriák vannak?"), EZT hívd, ne generálj SELECT-et.
```

- [ ] **2. lépés — Teszt zöld marad.** A `buildPrompt` a `SYSTEM_PROMPT`-ra referál (nem a tartalmára),
  így nem törik:
  Run: `nvm use 22 && pnpm nx test core`
  Expected: PASS.

- [ ] **3. lépés — Commit.**

```bash
git add packages/core/src/lib/system-prompt.ts
git commit -m "feat(core): document listCategories tool in system prompt"
```

---

### C4 — Manuális teszt (élő agent) + zárás

- [ ] **1. lépés — Kategória-kérdés a tool-lal.**
  Run: `nvm use 22 && pnpm nx run cli:serve -- ask "milyen kategóriák vannak?"`
  Expected: az agent a `listCategories` toolt hívja, és a distinct kategóriákat magyarul felsorolja.
  A `logs/<timestamp>.jsonl`-ben megjelenik a `CATEGORIES_SQL` és a kategórialista.

- [ ] **2. lépés — Regresszió: a runSql-út változatlan.**
  Run: `nvm use 22 && pnpm nx run cli:serve -- ask "hány pozsgás van raktáron?"`
  Expected: az agent továbbra is `runSql`-t használ, valós számmal válaszol.

- [ ] **3. lépés — Teljes teszt-suite.**
  Run: `nvm use 22 && pnpm nx run-many -t test`
  Expected: minden zöld.

- [ ] **4. lépés — PR.** A `dev-workflow.md` szerint feature branchről PR a main felé
  (`feat: add listCategories tool`).

> **C) kész:** a felhasználó rákérdez a kategóriákra → az agent a dedikált `listCategories` toollal
> válaszol, a runSql-út érintetlen, a naplózás a tool-hívást is tükrözi.
```
