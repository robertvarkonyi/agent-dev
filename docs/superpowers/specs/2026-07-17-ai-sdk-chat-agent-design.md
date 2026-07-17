# Design — Vercel AI SDK a Plantbase chat agentben

- **Dátum:** 2026-07-17
- **Ág:** `feat/ai-sdk-chat-agent`
- **Állapot:** jóváhagyásra vár

## Cél és motiváció

A chat agent jelenleg a hivatalos `@anthropic-ai/sdk` kliensre épülő, **kézzel írt**
tool-use loopot használ ([packages/core/src/lib/ask-agent.ts](../../../packages/core/src/lib/ask-agent.ts)).
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
döntés **szándékos visszafordítása**, nem puszta függőségcsere. A doksit frissítjük (lásd
lentebb), hogy ne mondjon valótlant.

### Megőrzött invariánsok (nem tárgyalható)

Az SDK-tól függetlenül változatlanul megmarad:

- **Read-only SQL-guard** — `assertSelectOnly` + read-only DB-role kettős védelme.
- **JSONL naplózás** — minden interakció naplózva (`logInteraction`).
- **Token/usage követés** — `{ input_tokens, output_tokens }`.
- **`--show-prompt`** — a teljes prompt kiírható.

## Döntések (a brainstorming során rögzítve)

| Kérdés | Döntés |
|--------|--------|
| Fő cél | provider-rugalmasság + többfordulós memória + streaming |
| A rewrite hatóköre | **A core újraírása**, mindkét parancs (`ask` + `chat`) rá épül |
| Providerek | **Csak Anthropic**, env-vezérelt factory-val (csere-kész) |

## Architektúra

### 1. Függőségek és provider-factory

- **`packages/core`**: `+ ai` (v5), `+ @ai-sdk/anthropic`, `- @anthropic-ai/sdk`
  (a rewrite után semmi más nem importálja).
- **Új fájl: `packages/core/src/lib/provider.ts`** — az egyetlen csere-pont.
  Env-ből épít egy AI SDK `LanguageModel`-t:
  - `AI_PROVIDER` (alap: `anthropic`) választja az ágat; ismeretlen érték → fail-fast,
    beszédes magyar hiba.
  - `ANTHROPIC_MODEL` (alap: `claude-sonnet-4-6`), `ANTHROPIC_API_KEY` (hiány → a mai
    `getConfig`-gal azonos fail-fast hiba).
  - OpenAI később = `@ai-sdk/openai` telepítés + egyetlen `case` ág itt. A kód sehol
    máshol nem nevez meg providert.

### 2. Tool-regiszter (marad az egyetlen bővítési pont)

A regiszter marad az egyetlen hely, ahová új tool kerül (megőrzi a CLAUDE.md-t és a
`new-agent-tool` skillt). Az `AgentTool` típus lekerül az `Anthropic.Tool`-ról egy sima
alakra:

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;              // Zod, nem kézzel írt JSON Schema
  run(input): Promise<{ sql: string; rows: unknown }>;
}
```

Egy `buildAiTools(collector)` builder a `TOOLS`-t az AI SDK
`{ [name]: tool({ description, inputSchema, execute }) }` alakjára képezi. Minden `execute`
meghívja a `run`-t, **betolja a `{ sql, rows }`-t a futás-hatókörű `collector`-ba**, és a
`rows`-t adja vissza a modellnek. Így marad hű az SQL-naplózás (a `run-sql`-ből jövő
guardolt, normalizált SQL), miközben a loopot már az SDK birtokolja — a collector
mellékhatásként töltődik, agent-hívásonként egy tömb.

A [run-sql.ts](../../../packages/core/src/lib/tools/run-sql.ts) (a `assertSelectOnly`
guard, a read-only pool) **érintetlen** — a `run()` csak becsomagolja, mint ma.

### 3. Core agent: két belépési pont

Az `ask-agent.ts` megtartja a fájlnevét és a `buildPrompt`/`QuestionSchema` bemenet-
validációt. Az `extractText` **törlődik** (az SDK közvetlenül ad `text`-et — a két tesztje
elmarad). Két függvény:

- **`askAgent(input): Promise<AgentResult>`** — egyfordulós, `generateText({ model, system,
  messages, tools, stopWhen: stepCountIs(6) })`. Az SDK `usage.inputTokens/outputTokens`-t
  a meglévő `{ input_tokens, output_tokens }` alakra képezi (a logger kompatibilis marad).
  Egyszer naplóz `logInteraction`-nal, az SQL-t a collectorból véve. Ez hajtja az `ask`-ot.

- **`streamChat(messages): ChatStream`** — többfordulós + streaming, `streamText(...)`.
  Egy kis stabil wrappert ad vissza, hogy a CLI soha ne érintse az SDK-típusokat:

  ```ts
  interface ChatStream {
    textStream: AsyncIterable<string>;
    done: Promise<{ answer: string; usage: Usage; messages: ModelMessage[] }>;
  }
  ```

  A naplózás a `streamText` `onFinish` callbackjében történik (a core-ban — az invariáns
  megmarad). A `done.messages` a frissített előzmény (`response.messages`), amit a CLI
  hozzáfűz, hogy a beszélgetés folytatódjon.

A `MAX_STEPS` (6) → `stopWhen: stepCountIs(6)`. Ugyanaz a végtelen-loop védelem, most az
SDK-é.

### 4. CLI-bekötés és többfordulós memória

[apps/cli/src/main.ts](../../../apps/cli/src/main.ts):

- **`ask`** → `askAgent`, a bufferelt választ írja ki (változatlan UX).
- **`chat`** → a readline-session alatt tart egy `messages: ModelMessage[]` tömböt. Minden
  sornál: push `{ role:'user', content }`, `streamChat(messages)` hívás, a `textStream`
  darabjait **`stdout`-ra streameli** ahogy érkeznek, majd `await done` és a `messages`-t
  a `done.messages`-re cseréli. Kilépéskor az előzmény elveszik — nincs perzisztálás.
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
  beszédes magyar üzenettel (a mai viselkedéssel egyezően).
- Tool-hiba (pl. SELECT-guard elutasít) → az SDK a hibát tool-eredményként adja vissza a
  modellnek, ami újrapróbálhat; a nyers hibaüzenet nem szivárog a felhasználóhoz (system
  prompt szabály + `errorMessage` a CLI-határon).
- Üres/érvénytelen bemenet → `QuestionSchema` (`ask`), illetve a chat üres sort ma is
  kihagy.

## Tesztek

Determinisztikus, hálózat nélkül (a Vitest-konvenció szerint):

- `ask-agent.spec.ts` újraírva az SDK `MockLanguageModelV2`-jével (`ai/test`) — egyfordulós
  válasz, egy tool-körút, és hogy a collector→logger elkapja az SQL-t.
- `registry.spec.ts` frissítve az új `AgentTool` alakra + `buildAiTools`-ra.
- `run-sql.spec.ts`, `errors.spec.ts`, `logger.spec.ts`, `list-categories.spec.ts`
  változatlan.
- `provider.ts` kap egy kis spec-et (env-választás + hiányzó kulcs hiba).

## Doksi-frissítések

- [architektura.md](../../architektura.md) 3. elv: „kézzel írt loop" → „AI SDK birtokolta
  loop, provider-cserélhető", a látható-mechanika indoklás átfogalmazásával.
- CLAUDE.md kulcsfájlok/konvenciók sorai, hogy a tool-regiszter mint bővítési pont és az
  új core-belépési pontok naprakészek legyenek.

## Hatókörön kívül (YAGNI)

- Második provider tényleges bekötése (OpenAI kulcs kell hozzá) — csak a factory-ág kész.
- Chat-előzmény perzisztálása lemezre / session-ök közt.
- Előzmény-méret korlátozása / tömörítése (a session rövid, memóriában elfér).
- Web/HTTP felület, `useChat` UI — ez CLI marad.

## Nyitott kockázatok

- Az AI SDK v5 pontos helper-nevei (`stepCountIs` vs `isStepCount`) és a `usage` mezőnevek
  verzióspecifikusak — a plan lépésében a telepített verzió doksijából (Context7)
  megerősítjük kódolás előtt (architektura.md 7. elv).
