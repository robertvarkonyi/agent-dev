# Vercel AI SDK a chat agentben — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Plantbase agent-magját a Vercel AI SDK-ra építjük át — provider-cserélhető modell, streamelt + többfordulós `chat`, változatlan egyfordulós `ask` — a read-only SQL-guard, a JSONL-naplózás, a usage-követés és a `--show-prompt` megőrzésével.

**Architecture:** Egy env-vezérelt `provider.ts` factory adja a modellt (most csak Anthropic, csere-kész). A két tool egy új `agent-tools.ts` `buildTools(collector)` modulba kerül (AI SDK `tool()` + Zod), a collector fogja fel a naplózandó SQL-t. Az `ask-agent.ts` két belépési pontot ad: `askAgent` (`generateText`, egyfordulós) és `streamChat` (`streamText`, streaming + memória). A CLI a `chat`-ben `ChatMessage[]` előzményt tart és `stdout`-ra streamel.

**Tech Stack:** TypeScript (strict, ESM), `ai@^5`, `@ai-sdk/anthropic@^2`, `zod@^4`, `vitest`, Nx + pnpm, commander, Node 22.

## Global Constraints

- **Node 22** — minden `pnpm`/`nx` parancs előtt `nvm use 22` (a `.nvmrc` 22; a harness shell alapból node 20).
- **SDK-verziók:** `ai@^5`, `@ai-sdk/anthropic@^2` (a legújabb v7; a bump külön follow-up — NE v7-et telepíts).
- **Zod:** a meglévő `zod@^4.4.3`-at használd (az `ai@^5` peer-je `^3.25.76 || ^4.1.8` — ✓).
- **Megőrzött invariánsok:** read-only SQL-guard (`assertSelectOnly`, [run-sql.ts](../../../packages/core/src/lib/run-sql.ts) érintetlen); JSONL-napló változatlan `InteractionLog` alakkal; `usage` mindig `{ input_tokens, output_tokens }`; `--show-prompt` működik `ask`-ban és `chat`-ben is.
- **Modell-default:** `claude-sonnet-4-6`. Env: `ANTHROPIC_API_KEY` (kötelező), `ANTHROPIC_MODEL` (opcionális), `AI_PROVIDER` (opcionális, alap `anthropic`).
- **Kód-konvenciók** ([konvenciok.md](../../../docs/konvenciok.md)): magyar kommentek, `singleQuote`, `strict` TS, explicit típus a publikus API-n, TDD (piros→zöld), egy fájl egy felelősség.
- **`.js` a relatív importokon** (a `moduleResolution: nodenext` ezt megköveteli — a `pnpm nx typecheck` különben vörös): minden relatív import (a spec-fájlokban is) `.js`-re végződjön, pl. `from './provider.js'`.
- **Git:** a `feat/ai-sdk-chat-agent` ágon dolgozunk (már létrehozva main-ről). Conventional Commits, koherens lépésenként egy commit.
- **Determinista tesztek:** hálózat és DB nélkül. Az LLM-hívást a teszt sosem éri el — az `ai` modult (`generateText`/`streamText`) mockoljuk, a DB-t (`run-sql`) is. A valós agent-választ manuálisan / evallal ellenőrizzük.

---

### Task 1: Provider-factory (`provider.ts`) + függőségek

**Files:**
- Modify: `packages/core/package.json` (deps: `+ ai@^5`, `+ @ai-sdk/anthropic@^2`; a `@anthropic-ai/sdk` eltávolítása a Task 3-ban lesz)
- Create: `packages/core/src/lib/provider.ts`
- Test: `packages/core/src/lib/provider.spec.ts`

**Interfaces:**
- Produces: `resolveModel(): LanguageModel` — env-ből (`AI_PROVIDER`/`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`) épített AI SDK modell; fail-fast hiba ismeretlen providerre és hiányzó kulcsra.

- [ ] **Step 1: Telepítsd az AI SDK csomagokat a core libbe**

Run:
```bash
nvm use 22 && pnpm --filter @plantbase/core add 'ai@^5' '@ai-sdk/anthropic@^2'
```
Expected: `package.json` dependencies közé bekerül `ai` (5.x) és `@ai-sdk/anthropic` (2.x); a lockfile frissül. Ellenőrzés:
```bash
node -e "const d=require('./packages/core/package.json').dependencies; console.log(d.ai, d['@ai-sdk/anthropic'])"
```
Expected: két `^5....` / `^2....` verzió, nem `undefined`.

- [ ] **Step 2: Írd meg a bukó tesztet — `provider.spec.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveModel } from './provider';

describe('resolveModel', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('anthropic modellt ad vissza a beállított modell-id-vel', () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-teszt';
    process.env.ANTHROPIC_MODEL = 'claude-teszt';
    const model = resolveModel();
    expect((model as { modelId: string }).modelId).toBe('claude-teszt');
  });

  it('hibát dob ismeretlen providerre', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.ANTHROPIC_API_KEY = 'sk-teszt';
    expect(() => resolveModel()).toThrow(/Ismeretlen AI_PROVIDER/);
  });

  it('hibát dob, ha hiányzik az ANTHROPIC_API_KEY', () => {
    process.env.AI_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveModel()).toThrow(/ANTHROPIC_API_KEY/);
  });
});
```

- [ ] **Step 3: Futtasd — piros**

Run: `nvm use 22 && pnpm nx test core`
Expected: FAIL — `Cannot find module './provider'` (a `provider.ts` még nincs).

- [ ] **Step 4: Írd meg a minimális implementációt — `provider.ts`**

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

// A modell-választás egyetlen csere-pontja. Új provider = egy új ág ide, sehol máshol.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Env-ből épít egy AI SDK modellt. Fail-fast, beszédes magyar hibával (mint a régi getConfig).
export function resolveModel(): LanguageModel {
  const provider = process.env.AI_PROVIDER ?? 'anthropic';
  if (provider !== 'anthropic') {
    throw new Error(
      `Ismeretlen AI_PROVIDER: ${provider}. Jelenleg csak az 'anthropic' támogatott.`,
    );
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Hiányzik az ANTHROPIC_API_KEY. Állítsd be a .env fájlban.');
  }
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  return createAnthropic({ apiKey })(model);
}
```

- [ ] **Step 5: Futtasd — zöld**

Run: `nvm use 22 && pnpm nx test core`
Expected: PASS (a 3 új `resolveModel` teszt zöld; a régiek is).
Ha a `.modelId` property nem stimmel (verzió-eltérés), nézd meg a telepített típust:
`node -e "console.log(Object.keys(require('@ai-sdk/anthropic').createAnthropic({apiKey:'x'})('m')))"` és igazítsd az assertiont a valós property-névre.

- [ ] **Step 6: Typecheck**

Run: `nvm use 22 && pnpm nx typecheck core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/lib/provider.ts packages/core/src/lib/provider.spec.ts pnpm-lock.yaml
git commit -m "$(printf 'feat: AI SDK provider-factory (Anthropic, env-vezérelt)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Tool-modul (`agent-tools.ts`) collectorral

**Files:**
- Create: `packages/core/src/lib/agent-tools.ts`
- Test: `packages/core/src/lib/agent-tools.spec.ts`

**Interfaces:**
- Consumes: `runSql` ([run-sql.ts](../../../packages/core/src/lib/run-sql.ts)), `listCategories` + `CATEGORIES_SQL` ([list-categories.ts](../../../packages/core/src/lib/list-categories.ts)); `tool` az `ai`-ból.
- Produces:
  - `interface ToolCall { sql: string; rows: unknown }`
  - `buildTools(collector: ToolCall[])` → `{ runSql: Tool, listCategories: Tool }` AI SDK tools-objektum. Minden `execute` a `collector`-ba tolja a `{ sql, rows }`-t (naplózáshoz) és a `rows`-t adja vissza a modellnek.

- [ ] **Step 1: Írd meg a bukó tesztet — `agent-tools.spec.ts`**

A DB-t (`run-sql`) és a `list-categories`-t mockoljuk, hogy determinista és hálózat-mentes legyen; közvetlenül a tool `execute`-ját hívjuk.

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./run-sql.js', () => ({
  runSql: vi.fn(async (q: string) => ({ sql: q.trim(), rows: [{ id: 1 }], rowCount: 1 })),
}));
vi.mock('./list-categories.js', () => ({
  CATEGORIES_SQL: 'SELECT DISTINCT category FROM products ORDER BY category',
  listCategories: vi.fn(async () => ['kaktusz', 'pozsgás']),
}));

import { buildTools, type ToolCall } from './agent-tools.js';

// Az AI SDK execute második paramétere a ToolCallOptions — a tesztben minimál stub elég.
const opts = { toolCallId: 't1', messages: [] } as never;

describe('buildTools', () => {
  it('a runSql execute a collectorba tolja az SQL-t és a sorokat adja vissza', async () => {
    const collector: ToolCall[] = [];
    const tools = buildTools(collector);
    const rows = await tools.runSql.execute!({ query: 'SELECT * FROM products' }, opts);
    expect(rows).toEqual([{ id: 1 }]);
    expect(collector).toEqual([{ sql: 'SELECT * FROM products', rows: [{ id: 1 }] }]);
  });

  it('a listCategories execute a fix SQL-t naplózza és a kategóriákat adja vissza', async () => {
    const collector: ToolCall[] = [];
    const tools = buildTools(collector);
    const cats = await tools.listCategories.execute!({}, opts);
    expect(cats).toEqual(['kaktusz', 'pozsgás']);
    expect(collector[0]?.sql).toContain('DISTINCT category');
  });
});
```

- [ ] **Step 2: Futtasd — piros**

Run: `nvm use 22 && pnpm nx test core`
Expected: FAIL — `Cannot find module './agent-tools'`.

- [ ] **Step 3: Írd meg az implementációt — `agent-tools.ts`**

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { runSql } from './run-sql.js';
import { listCategories, CATEGORIES_SQL } from './list-categories.js';

// Egy tool-hívás naplózandó nyoma: a ténylegesen futott SQL + a modellnek adott sorok.
export interface ToolCall {
  sql: string;
  rows: unknown;
}

// A tool-ok egyetlen helye (ez váltja az inline Anthropic.Tool konstansokat). Új tool = egy
// bejegyzés ide. A `collector` futás-hatókörű: minden execute mellékhatásként belépteti a
// naplózandó { sql, rows }-t, miközben a modellnek csak a rows megy vissza.
export function buildTools(collector: ToolCall[]) {
  return {
    runSql: tool({
      description:
        'Read-only SQL (SELECT) futtatása a products katalóguson. A generált SELECT-et mindig ezzel futtasd, majd az eredményből válaszolj.',
      inputSchema: z.object({
        query: z.string().describe('A futtatandó SELECT lekérdezés (PostgreSQL).'),
      }),
      execute: async ({ query }) => {
        const { sql, rows } = await runSql(query);
        collector.push({ sql, rows });
        return rows;
      },
    }),
    listCategories: tool({
      description:
        'A katalógus egyedi (distinct) kategóriáinak listája. Akkor hívd, ha a felhasználó a kategóriákra kérdez rá — ne generálj hozzá SQL-t.',
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

- [ ] **Step 4: Futtasd — zöld**

Run: `nvm use 22 && pnpm nx test core`
Expected: PASS (a 2 új `buildTools` teszt zöld).

- [ ] **Step 5: Typecheck**

Run: `nvm use 22 && pnpm nx typecheck core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lib/agent-tools.ts packages/core/src/lib/agent-tools.spec.ts
git commit -m "$(printf 'feat: agent-tools modul (AI SDK tool + SQL-collector)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `askAgent` átírása `generateText`-re + `@anthropic-ai/sdk` eltávolítása

**Files:**
- Modify: `packages/core/src/lib/ask-agent.ts` (teljes átírás)
- Modify: `packages/core/src/lib/ask-agent.spec.ts` (az `extractText` tesztek törlése, `askAgent` tesztek hozzáadása, a `buildPrompt` tesztek megtartása)
- Modify: `packages/core/package.json` (`- @anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `resolveModel` (Task 1), `buildTools` + `ToolCall` (Task 2), `SYSTEM_PROMPT`, `logInteraction`.
- Produces (a Task 4 és a CLI erre épül):
  - `interface Prompt { system: string; messages: ModelMessage[] }`
  - `interface AgentResult { answer: string; usage: { input_tokens: number; output_tokens: number } }`
  - `buildPrompt(input: unknown): Prompt`
  - `askAgent(input: unknown, model?: LanguageModel): Promise<AgentResult>` — a `model` alapból `resolveModel()`; teszthez injektálható.
  - `mapUsage(u): AgentResult['usage']` (nem exportált segéd — a Task 4 újrahasználja ugyanebben a fájlban).

- [ ] **Step 1: Írd át a tesztet — `ask-agent.spec.ts`**

Az `extractText` megszűnik; a `buildPrompt` tesztek maradnak; az `askAgent`-et a mockolt `ai` (`generateText`) fölött teszteljük, a naplózást (`logInteraction`) és a DB-t (`run-sql`) is mockolva.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A naplózást elkapjuk (az invariáns: minden interakció naplózódik).
const logSpy = vi.fn();
vi.mock('./logger.js', () => ({ logInteraction: (...a: unknown[]) => logSpy(...a) }));

// A DB-t mockoljuk, hogy a tool-execute hálózat nélkül fusson.
vi.mock('./run-sql.js', () => ({
  runSql: vi.fn(async (q: string) => ({ sql: q.trim(), rows: [{ n: 1 }], rowCount: 1 })),
}));

// Az 'ai'-ból csak a generateText-et stuboljuk; a tool()/stepCountIs valódi marad.
const generateTextMock = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: (...a: unknown[]) => generateTextMock(...a) };
});

import { askAgent, buildPrompt } from './ask-agent.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

describe('buildPrompt', () => {
  it('a system promptot és a user üzenetet adja vissza', () => {
    const prompt = buildPrompt('szia');
    expect(prompt.system).toBe(SYSTEM_PROMPT);
    expect(prompt.messages).toEqual([{ role: 'user', content: 'szia' }]);
  });

  it('trimmeli a kérdést', () => {
    expect(buildPrompt('  szia  ').messages[0].content).toBe('szia');
  });

  it('hibát dob üres kérdésre', () => {
    expect(() => buildPrompt('   ')).toThrow();
  });
});

describe('askAgent', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    logSpy.mockReset();
  });

  it('a modell szövegét adja vissza és a usage-t {input_tokens,output_tokens}-re képezi', async () => {
    generateTextMock.mockResolvedValue({
      text: 'Kész.',
      usage: { inputTokens: 10, outputTokens: 5 },
      response: { messages: [{ role: 'assistant', content: 'Kész.' }] },
    });
    const res = await askAgent('szia', {} as never);
    expect(res.answer).toBe('Kész.');
    expect(res.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('naplózza az interakciót, benne a collector SQL-jével', async () => {
    // A stubolt generateText lefuttatja a runSql toolt, hogy a collector megteljen.
    generateTextMock.mockImplementation(
      async (opts: { tools: ReturnType<typeof import('./agent-tools').buildTools> }) => {
        await opts.tools.runSql.execute!(
          { query: 'SELECT * FROM products' },
          { toolCallId: 't', messages: [] } as never,
        );
        return {
          text: 'Egy termék.',
          usage: { inputTokens: 1, outputTokens: 1 },
          response: { messages: [{ role: 'assistant', content: 'Egy termék.' }] },
        };
      },
    );
    await askAgent('mutass egy terméket', {} as never);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0][0] as { sql: string; answer: string };
    expect(entry.sql).toContain('SELECT * FROM products');
    expect(entry.answer).toBe('Egy termék.');
  });
});
```

- [ ] **Step 2: Futtasd — piros**

Run: `nvm use 22 && pnpm nx test core`
Expected: FAIL — a régi `ask-agent.ts` még az Anthropic-loop; nincs `generateText`-alapú `askAgent`, és az `extractText` importja megszűnt a tesztből (a mock-szerkezet nem illik a régi kódhoz).

- [ ] **Step 3: Írd át az implementációt — `ask-agent.ts`**

Teljes csere (az inline Anthropic-tool konstansok, a kézi loop és az `extractText` törlődik):

```ts
import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import { z } from 'zod';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { logInteraction } from './logger.js';
import { resolveModel } from './provider.js';
import { buildTools, type ToolCall } from './agent-tools.js';

// A többlépéses tool-use loop felső korlátja (most az SDK-é: stopWhen).
const MAX_STEPS = 6;

// A bemenet megbízhatatlan (user input): validáljuk a rendszer-határon, fail-fast.
const QuestionSchema = z.string().trim().min(1, 'A kérdés nem lehet üres.');

export interface Prompt {
  system: string;
  messages: ModelMessage[];
}

export interface AgentResult {
  answer: string;
  usage: { input_tokens: number; output_tokens: number };
}

// A CLI ezt tartja a chat-előzményben (nem importál 'ai'-t közvetlenül).
export type ChatMessage = ModelMessage;

// A kérdésből felépíti a system promptot + üzenet-tömböt (--show-prompt + askAgent).
export function buildPrompt(input: unknown): Prompt {
  const result = QuestionSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Érvénytelen bemenet.');
  }
  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: result.data }],
  };
}

// Az AI SDK usage-mezőit a meglévő napló-alakra képezi (0 default, ha a provider nem ad értéket).
function mapUsage(
  u: { inputTokens?: number; outputTokens?: number } | undefined,
): AgentResult['usage'] {
  return { input_tokens: u?.inputTokens ?? 0, output_tokens: u?.outputTokens ?? 0 };
}

// A modell azonosítója a naplóhoz (string modell-id vagy a LanguageModel.modelId).
function modelId(model: LanguageModel): string {
  return typeof model === 'string'
    ? model
    : (model as { modelId?: string }).modelId ?? 'unknown';
}

// Egyfordulós agent: a modell a buildTools tooljaival dolgozik, az SDK futtatja a
// többlépéses loopot (stopWhen), majd természetes nyelvű választ ad. A `model` teszthez
// injektálható; alapból az env-vezérelt resolveModel().
export async function askAgent(
  input: unknown,
  model: LanguageModel = resolveModel(),
): Promise<AgentResult> {
  const prompt = buildPrompt(input);
  const collector: ToolCall[] = [];

  const result = await generateText({
    model,
    system: prompt.system,
    messages: prompt.messages,
    tools: buildTools(collector),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const usage = mapUsage(result.usage);
  logInteraction({
    timestamp: new Date().toISOString(),
    model: modelId(model),
    system: prompt.system,
    messages: result.response.messages,
    answer: result.text,
    usage,
    sql: collector.map((c) => c.sql).join('\n'),
    result: collector.map((c) => c.rows),
  });

  return { answer: result.text, usage };
}
```

> **Megjegyzés a Task 4-hez:** a `streamChat` ugyanebbe a fájlba kerül, és újrahasználja a
> `mapUsage`, `modelId`, `MAX_STEPS`, `SYSTEM_PROMPT`, `buildTools` elemeket.

- [ ] **Step 4: Távolítsd el a `@anthropic-ai/sdk` függőséget**

Run:
```bash
nvm use 22 && pnpm --filter @plantbase/core remove @anthropic-ai/sdk
```
Expected: eltűnik a `packages/core/package.json` dependencies közül. Ellenőrzés (semmi sem importálja):
```bash
grep -rn "@anthropic-ai/sdk" packages apps --include='*.ts' | grep -v node_modules || echo "NINCS TÖBBÉ IMPORT"
```
Expected: `NINCS TÖBBÉ IMPORT`.

- [ ] **Step 5: Futtasd — zöld**

Run: `nvm use 22 && pnpm nx test core`
Expected: PASS (buildPrompt 3 + askAgent 2 + a korábbi taskok tesztjei + run-sql/logger/list-categories).

- [ ] **Step 6: Typecheck**

Run: `nvm use 22 && pnpm nx typecheck core`
Expected: PASS. Ha a `generateText` a `messages: prompt.messages`-re típushibát ad, a `Prompt.messages` már `ModelMessage[]` — nem kell cast; ha mégis, `messages: prompt.messages as ModelMessage[]`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lib/ask-agent.ts packages/core/src/lib/ask-agent.spec.ts packages/core/package.json pnpm-lock.yaml
git commit -m "$(printf 'refactor: askAgent generateText-re, Anthropic-loop kivezetve\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: `streamChat` — streaming + többfordulós memória

**Files:**
- Modify: `packages/core/src/lib/ask-agent.ts` (a `streamChat` + `ChatStream` hozzáadása)
- Modify: `packages/core/src/lib/ask-agent.spec.ts` (a `streamText` mock + `streamChat` tesztek hozzáadása)

**Interfaces:**
- Consumes: minden a Task 3-ból (`mapUsage`, `modelId`, `buildTools`, `SYSTEM_PROMPT`, `MAX_STEPS`).
- Produces (a CLI erre épül):
  - `interface ChatStream { textStream: AsyncIterable<string>; done: Promise<{ answer: string; usage: AgentResult['usage']; messages: ChatMessage[] }> }`
  - `streamChat(messages: ChatMessage[], model?: LanguageModel): ChatStream` — a `done.messages` a bemenő üzenetek + az asszisztens válasza (a CLI ezzel frissíti az előzményt); a naplózás a `done` befejezőben történik.

- [ ] **Step 1: Bővítsd a tesztet `streamChat`-tel — `ask-agent.spec.ts`**

Egészítsd ki a fájl tetején az `ai`-mockot a `streamText`-tel, és adj hozzá egy új `describe`-ot.

Az `ai` mock-blokk (a Task 3-beli helyére) legyen:
```ts
const generateTextMock = vi.fn();
const streamTextMock = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: (...a: unknown[]) => generateTextMock(...a),
    streamText: (...a: unknown[]) => streamTextMock(...a),
  };
});
```

Az importhoz vedd fel a `streamChat`-et:
```ts
import { askAgent, buildPrompt, streamChat } from './ask-agent.js';
```

Új teszt-blokk:
```ts
describe('streamChat', () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    logSpy.mockReset();
  });

  it('streameli a szöveget, és a done a frissített előzményt + usage-t adja', async () => {
    streamTextMock.mockImplementation(() => {
      async function* gen() {
        yield 'Hel';
        yield 'ló';
      }
      return {
        textStream: gen(),
        text: Promise.resolve('Helló'),
        usage: Promise.resolve({ inputTokens: 3, outputTokens: 2 }),
        response: Promise.resolve({
          messages: [{ role: 'assistant', content: 'Helló' }],
        }),
      };
    });

    const history = [{ role: 'user' as const, content: 'szia' }];
    const { textStream, done } = streamChat(history, {} as never);

    let acc = '';
    for await (const chunk of textStream) acc += chunk;
    expect(acc).toBe('Helló');

    const result = await done;
    expect(result.answer).toBe('Helló');
    expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
    expect(result.messages).toEqual([
      { role: 'user', content: 'szia' },
      { role: 'assistant', content: 'Helló' },
    ]);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Futtasd — piros**

Run: `nvm use 22 && pnpm nx test core`
Expected: FAIL — `streamChat is not a function` / nincs exportálva.

- [ ] **Step 3: Add hozzá a `streamChat`-et — `ask-agent.ts`**

Bővítsd az importot a `streamText`-tel:
```ts
import {
  generateText,
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
```

Add hozzá a típust és a függvényt (az `askAgent` alá):
```ts
// A CLI felé stabil, SDK-mentes felület: token-stream + a befejezéskor feloldódó metaadat.
export interface ChatStream {
  textStream: AsyncIterable<string>;
  done: Promise<{
    answer: string;
    usage: AgentResult['usage'];
    messages: ChatMessage[];
  }>;
}

// Többfordulós, streamelő agent. A hívó a teljes előzményt (messages) adja át; a done.messages
// a bővített előzmény (bemenet + asszisztens válasz), amit a hívó visszaír. A naplózás a done
// befejezőben történik (a hívó CLI mindig await-eli a done-t az előzmény-frissítéshez).
export function streamChat(
  messages: ChatMessage[],
  model: LanguageModel = resolveModel(),
): ChatStream {
  const collector: ToolCall[] = [];
  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildTools(collector),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const done = (async () => {
    const [answer, rawUsage, response] = await Promise.all([
      result.text,
      result.usage,
      result.response,
    ]);
    const usage = mapUsage(rawUsage);
    const fullMessages: ChatMessage[] = [...messages, ...response.messages];
    logInteraction({
      timestamp: new Date().toISOString(),
      model: modelId(model),
      system: SYSTEM_PROMPT,
      messages: fullMessages,
      answer,
      usage,
      sql: collector.map((c) => c.sql).join('\n'),
      result: collector.map((c) => c.rows),
    });
    return { answer, usage, messages: fullMessages };
  })();

  return { textStream: result.textStream, done };
}
```

- [ ] **Step 4: Futtasd — zöld**

Run: `nvm use 22 && pnpm nx test core`
Expected: PASS (a `streamChat` teszt zöld, a többi is).

- [ ] **Step 5: Typecheck**

Run: `nvm use 22 && pnpm nx typecheck core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lib/ask-agent.ts packages/core/src/lib/ask-agent.spec.ts
git commit -m "$(printf 'feat: streamChat — streamelő, többfordulós agent-belépés\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: CLI — streamelő, memóriás `chat`

**Files:**
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/src/main.spec.ts` (a meglévő hálózat-mentes integrációs tesztek — nem módosulnak, csak zöldnek kell maradniuk)

**Interfaces:**
- Consumes: `askAgent`, `buildPrompt`, `streamChat`, `SYSTEM_PROMPT`, `type ChatMessage`, `type Prompt` a `@plantbase/core`-ból (mind exportált a barrel `export *`-jain át).

- [ ] **Step 1: Írd át a `main.ts`-t a streamelő chatre**

Csere-pontok: az import bővítése, és a `runInteractive` LLM-ága streamelővé + memóriássá tétele. Az `ask` parancs és az `answer()` egyfordulós helper változatlan.

Az import sor:
```ts
import {
  askAgent,
  buildPrompt,
  streamChat,
  SYSTEM_PROMPT,
  type ChatMessage,
  type Prompt,
} from '@plantbase/core';
```

A `runInteractive` függvény teljes cseréje:
```ts
function runInteractive(showPrompt: boolean): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'plantbase> ',
  });

  // A session alatt élő beszélgetés-előzmény (kilépéskor elveszik — nincs perzisztálás).
  const history: ChatMessage[] = [];

  console.log('Plantbase interaktív mód. Kilépés: exit');
  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (text === 'exit' || text === 'quit') {
      rl.close();
      return;
    }
    if (text.length > 0) {
      // Csak sikeres válasz után írjuk vissza az előzményt (hibánál a history érintetlen).
      const next: ChatMessage[] = [...history, { role: 'user', content: text }];
      if (showPrompt) {
        console.log(formatPrompt({ system: SYSTEM_PROMPT, messages: next }));
      }
      try {
        const { textStream, done } = streamChat(next);
        for await (const chunk of textStream) {
          process.stdout.write(chunk);
        }
        process.stdout.write('\n');
        const { messages } = await done;
        history.splice(0, history.length, ...messages);
      } catch (error) {
        console.error(
          `Hiba: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('Viszlát!');
    process.exit(0);
  });
}
```

A `formatPrompt` és az `answer()` (egyfordulós `ask`) marad, ahogy van.

- [ ] **Step 2: Futtasd a CLI integrációs teszteket — zöld**

Run: `nvm use 22 && pnpm nx test cli`
Expected: PASS — a `--help` felsorolja az `ask`/`chat` parancsokat, és az interaktív mód `exit`-re kilép (egyik út sem hív LLM-et, így hálózat-mentes marad).

- [ ] **Step 3: Typecheck**

Run: `nvm use 22 && pnpm nx typecheck cli`
Expected: PASS.

- [ ] **Step 4: Manuális ellenőrzés (streaming) — opcionális, valós kulccsal**

Az automata tesztek nem érintik az LLM-utat (a repó konvenciója szerint a valós választ manuálisan nézzük). Élő kulccsal:
```bash
nvm use 22 && pnpm cli
# plantbase> milyen kategóriák vannak?      → streamelt válasz
# plantbase> és ezek közül melyik a legolcsóbb?   → az előző fordulóra épít (memória)
# plantbase> exit
```
Expected: a szöveg tokenről tokenre jelenik meg; a második kérdés a kontextusra épít; a `logs/` alá új JSONL-rekord kerül.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/main.ts
git commit -m "$(printf 'feat: streamelő, memóriás chat a CLI-ben\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Doksi-frissítés (architektura.md + new-agent-tool skill)

**Files:**
- Modify: `docs/architektura.md` (3. elv)
- Modify: `.claude/skills/new-agent-tool/SKILL.md` (a tool-hozzáadás új mintája)

**Interfaces:** nincs kód; a doksi a valós architektúrát tükrözze.

- [ ] **Step 1: Frissítsd az `architektura.md` 3. elvét**

Keresd meg a 3. pontot ([architektura.md](../../../docs/architektura.md) 24. sor környéke):
> `3. **Saját agent-loop.** Az `askAgent` az Anthropic SDK-ra (hivatalos kliens, nem nyers HTTP) épülő, kézzel írt tool-use loop, agent-framework nélkül, hogy a mechanika látható maradjon ("az alapoktól").`

Cseréld erre:
```markdown
3. **AI SDK agent-loop, provider-cserélhető.** Az `askAgent` (egyfordulós) és a `streamChat` (streamelő, többfordulós) a Vercel AI SDK-ra épül: a többlépéses tool-use loopot az SDK futtatja (`stopWhen: stepCountIs`). A modellt egy env-vezérelt factory (`provider.ts`) adja — ma csak Anthropic, de a provider egy helyen cserélhető. A tool-ok a `agent-tools.ts` `buildTools(collector)`-jában élnek; a `collector` fogja fel a naplózandó SQL-t.
```

- [ ] **Step 2: Írd át a `new-agent-tool` skillt az új mintára**

A [SKILL.md](../../../.claude/skills/new-agent-tool/SKILL.md) 3–4. lépése ma inline `Anthropic.Tool` konstansról és loop-ágról szól — ez már nem létezik. Cseréld a 3. és 4. lépést erre az egy lépésre (a többi lépés — impl-fájl, spec, TDD, system-prompt, export, verifikáció — marad):

```markdown
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
```

Frissítsd a bevezető bekezdést is: a „kézzel írt, többlépéses tool-use loop" megfogalmazást
cseréld arra, hogy a loopot az AI SDK futtatja, a tool-ok az `agent-tools.ts`-ben élnek.

- [ ] **Step 3: Ellenőrzés — nincs elavult hivatkozás**

Run:
```bash
grep -n "Anthropic.Tool\|LIST_CATEGORIES_TOOL\|block.name\|kézzel írt tool-use" docs/architektura.md .claude/skills/new-agent-tool/SKILL.md || echo "NINCS ELAVULT HIVATKOZÁS"
```
Expected: `NINCS ELAVULT HIVATKOZÁS` (vagy csak szándékos, kontextusban helyes találatok).

- [ ] **Step 4: Commit**

```bash
git add docs/architektura.md .claude/skills/new-agent-tool/SKILL.md
git commit -m "$(printf 'docs: architektura + new-agent-tool skill az AI SDK-loopra\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Záró verifikáció (minden task után)

- [ ] **Teljes teszt + typecheck**

Run:
```bash
nvm use 22 && pnpm nx run-many -t test typecheck -p core cli
```
Expected: minden zöld. Ha egy AI SDK v5 API-név eltér (pl. `usage` mező, `.modelId`, `stepCountIs`), a telepített `node_modules/ai` / `@ai-sdk/anthropic` `.d.ts`-éből igazítsd — a plan feltevéseit a valós verzió írja felül (architektura.md 7. elv).

## Task-térkép a spec-hez (lefedettség)

| Spec szakasz | Task |
|---|---|
| 1. Függőségek + provider-factory | Task 1 |
| 2. `agent-tools.ts` (buildTools + collector) | Task 2 |
| 3. `askAgent` (generateText) | Task 3 |
| 3. `streamChat` (streamText) | Task 4 |
| 4. CLI-bekötés (streaming + memória) | Task 5 |
| Tesztek | Task 1–5 (specenként) |
| Doksi (architektura + new-agent-tool skill) | Task 6 |
| `@anthropic-ai/sdk` eltávolítása | Task 3 |
