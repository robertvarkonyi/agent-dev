# Design — Vercel AI SDK a Plantbase chat agentben

- **Dátum:** 2026-07-17
- **Ág:** `feat/ai-sdk-chat-agent`
- **Állapot:** jóváhagyva (v2 — a valós kódbázishoz igazítva)

> **v2 javítás:** az első verzió egy elavult kód-olvasatra épült (nem létező
> tool-regisztert és `errorMessage` helpert feltételezett). A valós kódban a két
> tool **inline** `Anthropic.Tool` konstans az `ask-agent.ts`-ben, a loop
> `block.name === '…'` ágakkal hívja őket; nincs regiszter, nincs `errorMessage`,
> nincs `CLAUDE.md`. A termék-döntések változatlanok; a baseline-leírás és a
> tool-szervezés frissült.

## Cél és motiváció

A chat agent jelenleg a hivatalos `@anthropic-ai/sdk` kliensre épülő, **kézzel írt**
tool-use loopot használ ([ask-agent.ts](../../../packages/core/src/lib/ask-agent.ts)):
a két tool (`RUN_SQL_TOOL`, `LIST_CATEGORIES_TOOL`) inline `Anthropic.Tool` konstans,
a `for` ciklus `block.name === 'runSql' / 'listCategories'` ágakkal futtatja őket.
A cél a Vercel AI SDK bevezetése, három konkrét igény miatt (a felhasználó választása):

1. **Provider-rugalmasság** — az Anthropic később cserélhető legyen (OpenAI/Google/…)
   a loop újraírása nélkül.
2. **Többfordulós chat-memória** — a `chat` valódi beszélgetés legyen, ne egymástól
   független kérdések sorozata (ma minden sor külön `askAgent()` hívás, előzmény nélkül).
3. **Streamelt kimenet** — a válasz tokenről tokenre jelenjen meg a CLI-ben.

### Tudatos architektúra-váltás

Az [architektura.md](../../architektura.md) 3. elve ma azt mondja: „saját, kézzel írt
tool-use loop, agent-framework nélkül, hogy a mechanika látható maradjon". A Vercel AI SDK
pontosan ezt a loopot absztrahálja el (`stopWhen`/`stepCountIs`). Ez tehát egy dokumentált
döntés **szándékos visszafordítása**, nem puszta függőségcsere. Két doksit frissítünk, hogy
ne mondjanak valótlant: az `architektura.md` 3. elvét és a
[new-agent-tool skillt](../../../.claude/skills/new-agent-tool/SKILL.md), amely ma az inline
`Anthropic.Tool` + loop-ág mintát írja le.

### Megőrzött invariánsok (nem tárgyalható)

Az SDK-tól függetlenül változatlanul megmarad:

- **Read-only SQL-guard** — `assertSelectOnly` + read-only DB-role kettős védelme
  ([run-sql.ts](../../../packages/core/src/lib/run-sql.ts) érintetlen).
- **JSONL naplózás** — minden interakció naplózva (`logInteraction`, változatlan alak).
- **Token/usage követés** — `{ input_tokens, output_tokens }`.
- **`--show-prompt`** — a teljes prompt kiírható.

## Döntések (a brainstorming során rögzítve)

| Kérdés             | Döntés                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| Fő cél             | provider-rugalmasság + többfordulós memória + streaming                      |
| A rewrite hatóköre | **A core újraírása**, mindkét parancs (`ask` + `chat`) rá épül               |
| Providerek         | **Csak Anthropic**, env-vezérelt factory-val (csere-kész)                    |
| SDK-verzió         | **`ai@^5` + `@ai-sdk/anthropic@^2`** (a legújabb v7; a bump külön follow-up) |
| Tool-ok helye      | **Dedikált `agent-tools.ts` modul** (`buildTools(collector)`)                |

## Architektúra

### 1. Függőségek és provider-factory

- **`packages/core`**: `+ ai@^5`, `+ @ai-sdk/anthropic@^2`, `- @anthropic-ai/sdk`.
  A `@anthropic-ai/sdk`-t **csak** az `ask-agent.ts` importálja — a rewrite után törölhető
  (a CLI, a `run-sql`, a `list-categories` nem függ tőle).
- **Új fájl: `packages/core/src/lib/provider.ts`** — az egyetlen csere-pont.
  Env-ből épít egy AI SDK `LanguageModel`-t `createAnthropic({ apiKey })(model)` hívással:
  - `AI_PROVIDER` (alap: `anthropic`) választja az ágat; ismeretlen érték → fail-fast,
    beszédes magyar hiba.
  - `ANTHROPIC_MODEL` (alap: `claude-sonnet-4-6`), `ANTHROPIC_API_KEY` (hiány → a mai
    `getConfig`-gal azonos fail-fast hiba).
  - OpenAI később = `@ai-sdk/openai` telepítés + egyetlen `case` ág itt. A kód sehol
    máshol nem nevez meg providert.

### 2. Tool-ok: dedikált `agent-tools.ts` modul

A mai inline `Anthropic.Tool` konstansok + hardkódolt loop-ágak helyett **egy új modul**
(`packages/core/src/lib/agent-tools.ts`) lesz a tool-ok egyetlen helye — ez váltja fel az
inline mintát, és ez lesz a new-agent-tool skill új célpontja.

```ts
import { tool, stepCountIs } from 'ai'; // stepCountIs a loophoz, lásd 3.
import { z } from 'zod';

export interface ToolCall {
  sql: string;
  rows: unknown;
}

// A futás-hatókörű collector minden tool-hívásnál töltődik (naplózáshoz).
export function buildTools(collector: ToolCall[]) {
  return {
    runSql: tool({
      description: 'Read-only SQL (SELECT) futtatása a products katalóguson. …',
      inputSchema: z.object({
        query: z.string().describe('A futtatandó SELECT (PostgreSQL).'),
      }),
      execute: async ({ query }) => {
        const { sql, rows } = await runSql(query);
        collector.push({ sql, rows });
        return rows; // csak a sorok mennek a modellhez
      },
    }),
    listCategories: tool({
      description: 'A katalógus egyedi kategóriáinak listája. …',
      inputSchema: z.object({}),
      execute: async () => {
        const categories = await listCategories();
        collector.push({ sql: CATEGORIES_SQL, rows: categories });
        return categories;
      },
    }),
  };
}
```

Így marad hű az SQL-naplózás (a `run-sql`-ből jövő guardolt, normalizált SQL), miközben a
loopot már az SDK birtokolja — a collector mellékhatásként töltődik, agent-hívásonként egy
tömb. A tool-hibát az SDK automatikusan tool-eredményként adja vissza a modellnek (nem kell
kézi `try/catch` a loopban).

### 3. Core agent: két belépési pont

Az `ask-agent.ts` megtartja a fájlnevét és a `buildPrompt`/`QuestionSchema` bemenet-
validációt (a `Prompt` típus is marad, a `--show-prompt` miatt). Az `extractText` **törlődik**
(az SDK közvetlenül ad `text`-et — a két tesztje elmarad). Két függvény:

- **`askAgent(input): Promise<AgentResult>`** — egyfordulós, `generateText({ model, system,
messages, tools, stopWhen: stepCountIs(6) })`. Az SDK `usage.inputTokens/outputTokens`-t
  a meglévő `{ input_tokens, output_tokens }` alakra képezi (0 default, ha a provider nem ad
  értéket). Egyszer naplóz `logInteraction`-nal, az SQL-t a collectorból véve. Ez hajtja az
  `ask`-ot. A `MAX_STEPS` (6) → `stopWhen: stepCountIs(6)` — ugyanaz a végtelen-loop védelem.

- **`streamChat(messages): ChatStream`** — többfordulós + streaming, `streamText(...)`.
  Egy kis stabil wrappert ad vissza, hogy a CLI soha ne érintse az SDK-típusokat:

  ```ts
  export type ChatMessage = ModelMessage; // az 'ai' ModelMessage alias
  export interface ChatStream {
    textStream: AsyncIterable<string>;
    done: Promise<{
      answer: string;
      usage: AgentResult['usage'];
      messages: ChatMessage[];
    }>;
  }
  ```

  A naplózás a `streamText` `onFinish` callbackjében történik (a core-ban — az invariáns
  megmarad). A `done.messages` a frissített előzmény (`response.messages`), amit a CLI
  hozzáfűz, hogy a beszélgetés folytatódjon.

### 4. CLI-bekötés és többfordulós memória

[apps/cli/src/main.ts](../../../apps/cli/src/main.ts):

- **`ask`** → `askAgent`, a bufferelt választ írja ki (változatlan UX). A hibaformázás a
  mai inline `error instanceof Error ? error.message : String(error)` marad (nincs
  `errorMessage` helper a repóban).
- **`chat`** → a readline-session alatt tart egy `messages: ChatMessage[]` tömböt (a típus a
  `@plantbase/core`-ból jön; a CLI nem importál `ai`-t). Minden sornál: push
  `{ role:'user', content }`, `streamChat(messages)` hívás, a `textStream` darabjait
  **`stdout`-ra streameli** ahogy érkeznek, majd `await done` és a `messages`-t a
  `done.messages`-re cseréli. Kilépéskor az előzmény elveszik — nincs perzisztálás.
  A `--show-prompt` továbbra is a system + aktuális messages-t írja ki fordulónként.

Ez a látható új viselkedés: a `chat` valódi, streamelt beszélgetés lesz; az `ask` tiszta
egyfordulós marad.

### 5. Adatfolyam

```
ask  <kérdés>  → askAgent → generateText(tools, stopWhen) → answer (buffer) → logInteraction
chat <sor>     → streamChat(messages) → streamText(tools, stopWhen)
                    → textStream → stdout (élő)
                    → onFinish → logInteraction; done.messages → CLI előzmény frissítés
tool-hívás     → execute → run() → { sql, rows } → collector.push + rows a modellnek
```

## Hibakezelés

- Hiányzó `ANTHROPIC_API_KEY` / ismeretlen `AI_PROVIDER` → fail-fast a `provider.ts`-ben,
  beszédes magyar üzenettel (a mai `getConfig` viselkedéssel egyezően).
- Tool-hiba (pl. SELECT-guard elutasít) → az AI SDK a hibát tool-eredményként adja vissza a
  modellnek, ami újrapróbálhat; a nyers hibaüzenet nem szivárog a felhasználóhoz (system
  prompt szabály + a CLI-határ inline hibaformázása).
- Üres/érvénytelen bemenet → `QuestionSchema` (`ask`), illetve a chat üres sort ma is
  kihagy.

## Tesztek

Determinisztikus, hálózat nélkül (a Vitest-konvenció szerint):

- **`agent-tools.spec.ts` (új)** — a `buildTools` collector-viselkedése: `MockLanguageModelV2`
  vagy közvetlen `execute`-hívás igazolja, hogy a tool `execute`-ja a `{ sql, rows }`-t a
  collectorba tolja és a `rows`-t adja vissza.
- **`ask-agent.spec.ts` (átírva)** — az SDK `MockLanguageModelV2`-jével (`ai/test`):
  egyfordulós válasz, egy tool-körút, és hogy a collector→logger elkapja az SQL-t. Az
  `extractText` tesztjei törlődnek; a `buildPrompt` tesztek maradnak.
- **`provider.spec.ts` (új)** — env-választás (default `anthropic`), ismeretlen provider hiba,
  hiányzó `ANTHROPIC_API_KEY` hiba.
- `run-sql.spec.ts`, `logger.spec.ts`, `list-categories.spec.ts` **változatlan**.

Nincs `registry.spec.ts` (nem létezett) és nincs `errors.spec.ts`.

## Doksi-frissítések

- [architektura.md](../../architektura.md) 3. elv: „kézzel írt loop" → „AI SDK birtokolta
  loop, provider-cserélhető", a látható-mechanika indoklás átfogalmazásával.
- **[new-agent-tool SKILL.md](../../../.claude/skills/new-agent-tool/SKILL.md) átírása**: a 3–4.
  lépés (inline `Anthropic.Tool` konstans + loop-ág) helyett az új minta: egy bejegyzés a
  `buildTools`-ba (`agent-tools.ts`), plusz a system-prompt `<tools>` sor. A tiszta-mag TDD,
  a `runSql` újrahasznosítás és a system-prompt-lépés változatlan.

(Nincs `CLAUDE.md` a repóban — az első verzió tévesen hivatkozott rá.)

## Hatókörön kívül (YAGNI)

- Második provider tényleges bekötése (OpenAI kulcs kell hozzá) — csak a factory-ág kész.
- Az `ai` v7-re bumpolás (most `^5` a pin) — külön follow-up.
- Chat-előzmény perzisztálása lemezre / session-ök közt.
- Előzmény-méret korlátozása / tömörítése (a session rövid, memóriában elfér).
- Web/HTTP felület, `useChat` UI — ez CLI marad.

## Nyitott kockázatok

- Az AI SDK v5 pontos helper-nevei (`stepCountIs`) és a `usage` mezőnevek
  (`inputTokens`/`outputTokens`) verzióspecifikusak — a plan Task 1-e a telepítés után
  `typecheck`-kel igazolja, kódolás előtt (architektura.md 7. elv).
