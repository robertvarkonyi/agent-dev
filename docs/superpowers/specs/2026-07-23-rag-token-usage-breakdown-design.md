# Token-használat kimutatás (RAG + agent) — design

**Dátum:** 2026-07-23
**Branch:** `feat/rag-knowledge-base`
**Állapot:** jóváhagyott design

## Cél

Amikor a felhasználó kérdést tesz fel (`ask` és `chat`), az app írja ki a
kérdés megválaszolása során elhasznált tokeneket, **provider és funkció szerint
lebontva**, majd egy **összes token** sorral. A kimutatás mindig megjelenik
(nem flag mögött), mind az egyszeri `ask`, mind az interaktív `chat` esetén.

## Kiindulási helyzet (miért kell)

Ma két, egymástól független token-mechanizmus létezik, és a felhasználói úton
egyik sem ér el a kimenetig:

- **Agent usage** (`packages/core`): `AgentResult.usage = { input_tokens,
output_tokens }`, csak az Anthropic orchestrátor modellt fedi. A CLI ezt
  eldobja (`apps/cli/src/main.ts:51` csak az `answer`-t veszi ki).
- **RAG `UsageTracker`** (`packages/rag/src/lib/providers/usage.ts`): provider
  szerint aggregál, de csak a `rag:index` / `rag:golden` parancsokba van
  bekötve.

A kritikus rés: a felhasználói kérdés útján a RAG providerek **tracker nélkül**
épülnek (`packages/core/src/lib/tools/agent-tools.ts:50`,
`createProviders(cfg)`), így az embed / HyDE / rerank / answer tokenek
elvesznek.

## Döntések

- **Trigger:** mindig bekapcsolva, `ask` **és** `chat` esetén is.
- **Riport-alak:** soronként egyetlen token-összeg (nincs input/output bontás,
  mert az OpenAI embedding és a Jina rerank csak összes tokent ad), plusz egy
  **Total** sor.

## Megközelítés

**Kérésenként egy `UsageTracker`, a tool-határon átfűzve.** Az `askAgent` /
`streamChat` hívásonként egy `UsageTracker` példányt hoz létre (nincs globális,
konkurenciára biztonságos), és ezt fűzi le a `buildTools`-on át a
`searchKnowledge` handlerig, ahol a `createProviders(cfg, tracker)` már ebbe
gyűjt. Az agent saját `totalUsage`-ét ugyanebbe a trackerbe adjuk hozzá `agent`
funkcióként. Az `askAgent` visszaadja a tracker snapshotját; a CLI rendereli.

Elvetett alternatívák: (B) modul-szintű ambient collector — megosztott mutable
állapot, konkurenciára törik, ütközik a fail-fast/explicit-határ konvencióval;
(C) a két usage-rendszer teljes egyesítése input/output bontással — túl invazív,
felesleges, mivel soronkénti összeget választottunk.

## Részletes terv

### 1. Adatmodell — `fn` (funkció) dimenzió a `UsageTracker`-be

`packages/rag/src/lib/providers/usage.ts` és
`packages/rag/src/lib/providers/providers.ts`.

- `add(provider, model, tokens)` → `add(provider, model, fn, tokens)`, ahol az
  `fn` a következők egyike: `embedding`, `hyde`, `rerank`, `rag-answer`,
  `agent`.
- `ProviderUsage` kap egy `fn: string` mezőt; a kulcs `provider:fn` (így a
  HyDE és a rag-answer külön sor marad, holott mindkettő Anthropic).
- A `createProviders` minden hívási ponton a fix címkét adja át (embed →
  `embedding`, hyde → `hyde`, rerank → `rerank`, answer → `rag-answer`).
- `snapshot()` és `totalTokens()` viselkedése marad; a `snapshot()` sorai most
  `fn`-t is hordoznak.
- A meglévő `rag:index` / `rag:golden` riport tovább működik (csak egy `fn`
  oszloppal bővül).

### 2. Usage átfűzése a RAG-ból az agentbe

`packages/core/src/lib/agent/ask-agent.ts`,
`packages/core/src/lib/tools/agent-tools.ts`.

**Lefelé (down path):**

- `askAgent(input, model)` és `streamChat(messages, model)` hívásonként egy
  `UsageTracker`-t hoz létre.
- `buildTools(collector)` → `buildTools(collector, tracker)`. A
  `searchKnowledge` handlerben (`agent-tools.ts:50`) a `createProviders(cfg)`
  helyett `createProviders(cfg, tracker)`.

**Felfelé (agent saját tokenjei):**

- A `generateText` / `streamText` lefutása után az orchestrátor `totalUsage`-ét
  egyetlen `add('anthropic', model, 'agent', input+output)` bejegyzésként adjuk a
  trackerhez.
- Mivel minden ebbe az egy trackerbe folyik be, **nem** kell `usage` mezőt tenni
  a `GroundedAnswer`-be, és nem kell a tool visszatérési értékén átvezetni — a
  tracker a hívás visszatéréséig már mindent tartalmaz.

**Visszatérési alak (nem breaking):**

- `AgentResult.usage = { input_tokens, output_tokens }` marad (orchestrátor
  összeg, ahogy ma is naplózódik).
- Új mező: `AgentResult.tokenBreakdown = { rows: { provider, fn, tokens }[];
total: number }` (a tracker snapshotja). Ugyanez a mező a `chat` `done`
  payloadjába is bekerül.
- A `tokenBreakdown` a JSONL interakció-logba is bekerül a `usage` mellé
  (`packages/core/src/lib/shared/logger.ts`).

### 3. CLI renderelés

`apps/cli/src/main.ts`.

- Egy közös renderelő (a meglévő `printUsage()` `main.ts:135-151` átalakítva /
  újrahasznosítva), hogy mindhárom felület (`ask`, `chat`, `rag:*`) azonosan
  nézzen ki.
- **`ask`** (`main.ts:44-57`): a `console.log(text)` után a `tokenBreakdown`
  alapján kiírja a táblát (soronként `(provider, fn)` + Total).
- **`chat`** (`runInteractive`, `main.ts:59-128`): minden fordulónál az
  `await done` után ugyanaz a tábla, **fordulónként** (nem kumulatív).
- A tábla a válaszszövegtől jól elkülönítve jelenik meg (a `printUsage` jelenlegi
  csatornáját/formátumát követve).
- Ha a kérdés nem indít RAG-ot (tiszta NL→SQL, nincs `searchKnowledge` hívás),
  a tábla csak az `agent` sort + Totalt mutatja — nincs külön üres-állapot ág.

Példa kimenet RAG-ot használó kérdésnél:

```
Token usage
  openai     embedding    1,240
  anthropic  hyde           320
  jina       rerank         890
  anthropic  rag-answer   2,110
  anthropic  agent        1,540
  ---------------------------
  Total                   6,100
```

### 4. Tesztek

Vitest, magyar leírások, `import { describe, it, expect } from 'vitest'` (nincs
global), ESM `.js` importok.

- **`UsageTracker` unit** (`packages/rag`): az új `fn` dimenzió helyesen
  kulcsol — azonos provider, két funkció (`hyde` vs `rag-answer`) két sort ad;
  az `add` `provider:fn`-enként halmozza a `calls`+`tokens`-t; a `totalTokens()`
  a sorokon átösszegez.
- **Provider-címkézés** (`packages/rag`): a trackert fogadó, kibővített
  `FakeProviders`-szel a `retrieve` / `answerFromKnowledge` a várt funkció-
  címkéket (`embedding`, `hyde`, `rerank`, `rag-answer`) rögzíti.
- **Agent-merge** (`packages/core`): fake modellel + fake providerekkel az
  `askAgent` olyan `tokenBreakdown`-t ad vissza, amely tartalmaz egy `agent`
  sort a RAG sorokkal együtt, és a `total` a sorok összege. NL→SQL (RAG nélküli)
  eset: csak az `agent` sor jelenik meg.
- **CLI render** (`apps/cli`): egy tiszta (pure) formázó függvény — kiemelve,
  hogy CLI-indítás nélkül tesztelhető legyen — a snapshotból a várt tábla-
  stringet állítja elő, a Total sorral együtt.

## Érintett fájlok

- `packages/rag/src/lib/providers/usage.ts` — `fn` mező + `add` szignatúra.
- `packages/rag/src/lib/providers/providers.ts` — funkció-címkék átadása.
- `packages/core/src/lib/agent/ask-agent.ts` — tracker létrehozás, agent-usage
  hozzáadás, `tokenBreakdown` a visszatérésben.
- `packages/core/src/lib/tools/agent-tools.ts` — `buildTools`/handler tracker,
  `createProviders(cfg, tracker)`.
- `packages/core/src/lib/shared/logger.ts` — `tokenBreakdown` naplózás.
- `apps/cli/src/main.ts` — közös renderelő + `ask`/`chat` kiírás.
- Tesztek a fenti csomagokban.

## YAGNI / hatókörön kívül

- Nincs USD/költség-számítás.
- Nincs input/output bontás soronként.
- Nincs kumulatív session-összeg a `chat`-ben (fordulónkénti riport).
- A két usage-rendszer teljes egyesítése nem cél.
