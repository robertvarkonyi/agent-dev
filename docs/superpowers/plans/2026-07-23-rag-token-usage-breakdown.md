# Token-használat kimutatás (RAG + agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Egy kérdés megválaszolásakor (`ask` és `chat`) az app kiírja a felhasznált tokeneket provider és funkció szerint lebontva, plusz egy összes-token sorral.

**Architecture:** Kérésenként egy `UsageTracker`-t hozunk létre az agentben, és a `buildTools`-on át a `searchKnowledge` handlerig fűzzük le, ahol a `createProviders(cfg, tracker)` már ebbe gyűjti a RAG-provider tokeneket (embedding, HyDE, rerank, rag-answer). Az agent-orchestrátor saját `totalUsage`-ét ugyanebbe a trackerbe adjuk `agent` funkcióként. Az `askAgent`/`streamChat` a tracker snapshotjából épített `tokenBreakdown`-t adja vissza; a CLI egy közös, tiszta formázóval rendereli.

**Tech Stack:** TypeScript (ESM + nodenext), Node 22 LTS, pnpm workspace + Nx, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), Vitest, commander + node:readline.

## Global Constraints

- **Node 22 LTS:** minden `pnpm`/`nx` parancs előtt `nvm use 22` (a shell alapból 20-at adhat).
- **ESM + nodenext:** relatív importok `.js` kiterjesztéssel, a `.spec.ts`-ekben is.
- **Vitest, nincs global:** minden teszt `import { describe, it, expect } from 'vitest'`. A leírások magyarul.
- **Readable spacing:** logikai lépések közé üres sor (a felhasználó a zsúfolt kódot nem szereti).
- **Read-only határ:** a `searchKnowledge`/agent útvonal csak `DATABASE_URL_READONLY`-n olvas; a `DATABASE_URL` (RW) SOSEM kerül ebbe az útba.
- **Nem breaking a napló:** `AgentResult.usage = { input_tokens, output_tokens }` marad; a `tokenBreakdown` új, additív mező.
- **Funkció-címkék (egyetlen forrás):** `embedding`, `hyde`, `rerank`, `rag-answer`, `agent` — a `UsageFn` konstansból, sehol string-literálként duplikálva.
- **Commitok:** gyakran, taskonként; magyar conventional-commit üzenet (`feat(rag):`, `feat(core):`, `feat(cli):`).

---

## Fájlstruktúra (mit érint)

**packages/rag**

- Modosít: `src/lib/providers/usage.ts` — `fn` dimenzió, `UsageFn` konstansok, `TokenBreakdown` + `toTokenBreakdown`.
- Modosít: `src/lib/providers/openai-embeddings.ts`, `src/lib/providers/anthropic-gen.ts`, `src/lib/providers/jina-rerank.ts` — a `UsageFn` címke átadása az `add`-nak.
- Modosít: `src/lib/providers/providers.ts` — `FakeProviders` opcionális trackert fogad és címkézve rögzít.
- Teszt: `src/lib/providers/tests/usage.spec.ts` (átírva), `src/lib/providers/tests/providers.spec.ts` (bővítve), `src/lib/pipeline/tests/retrieve.spec.ts` (bővítve).

**packages/core**

- Modosít: `src/lib/tools/agent-tools.ts` — `buildTools(collector, tracker?)`, `makeLiveAnswer(tracker?)`, `createProviders(cfg, tracker)`.
- Modosít: `src/lib/agent/ask-agent.ts` — tracker létrehozás, agent-sor hozzáadás, `tokenBreakdown` a visszatérésben és a stream `done`-ban.
- Modosít: `src/lib/shared/logger.ts` — `tokenBreakdown?` mező.
- Teszt: `src/lib/agent/tests/ask-agent.spec.ts` (bővítve).

**apps/cli**

- Létrehoz: `src/token-report.ts` — tiszta `formatTokenBreakdown(breakdown)` formázó.
- Modosít: `src/main.ts` — `ask`/`chat` kiírja a breakdown-t; `rag:index`/`rag:golden` ugyanazt a formázót használja; a régi `printUsage` törölve.
- Teszt: `src/token-report.spec.ts` (új).

---

## Task 1: RAG-oldali `fn` dimenzió, címkék és breakdown-leképzés

**Files:**

- Modify: `packages/rag/src/lib/providers/usage.ts`
- Modify: `packages/rag/src/lib/providers/openai-embeddings.ts:17`
- Modify: `packages/rag/src/lib/providers/anthropic-gen.ts:33,51`
- Modify: `packages/rag/src/lib/providers/jina-rerank.ts:42`
- Modify: `packages/rag/src/lib/providers/providers.ts`
- Test: `packages/rag/src/lib/providers/tests/usage.spec.ts` (átírás)
- Test: `packages/rag/src/lib/providers/tests/providers.spec.ts` (bővítés)
- Test: `packages/rag/src/lib/pipeline/tests/retrieve.spec.ts` (bővítés)

**Interfaces:**

- Produces:
  - `UsageFn` konstans: `{ embedding: 'embedding'; hyde: 'hyde'; rerank: 'rerank'; answer: 'rag-answer'; agent: 'agent' }` (`as const`).
  - `interface ProviderUsage { provider: string; model: string; fn: string; calls: number; tokens: number }`.
  - `UsageTracker.add(provider: string, model: string, fn: string, tokens: number): void` — kulcs `provider:fn`.
  - `interface TokenBreakdown { rows: { provider: string; fn: string; tokens: number }[]; total: number }`.
  - `toTokenBreakdown(usage: ProviderUsage[]): TokenBreakdown`.
  - `new FakeProviders(tracker?: UsageTracker)` — ha kap trackert, minden metódusa a `UsageFn` címkéjével rögzít.

### 1a. `UsageTracker` `fn` dimenzió + `toTokenBreakdown`

- [ ] **Step 1: Írd át a `usage.spec.ts`-t a `fn` dimenzióra (failing test)**

Cseréld a teljes fájl tartalmát erre:

```typescript
import { describe, it, expect } from 'vitest';
import { UsageTracker, toTokenBreakdown, UsageFn } from '../usage.js';

describe('UsageTracker', () => {
  it('provider:fn szerint összegzi a hívásokat és a tokeneket', () => {
    const t = new UsageTracker();

    t.add('openai', 'text-embedding-3-small', UsageFn.embedding, 100);
    t.add('openai', 'text-embedding-3-small', UsageFn.embedding, 50);
    t.add('anthropic', 'claude-haiku-4-5', UsageFn.hyde, 20);

    const snap = t.snapshot();

    expect(snap.find((u) => u.fn === 'embedding')).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      fn: 'embedding',
      calls: 2,
      tokens: 150,
    });
    expect(snap.find((u) => u.fn === 'hyde')?.calls).toBe(1);
    expect(t.totalTokens()).toBe(170);
  });

  it('azonos provider, két funkció (hyde vs rag-answer) két külön sor', () => {
    const t = new UsageTracker();

    t.add('anthropic', 'claude-haiku-4-5', UsageFn.hyde, 10);
    t.add('anthropic', 'claude-sonnet-4-6', UsageFn.answer, 30);

    expect(t.snapshot()).toHaveLength(2);
  });

  it('üres trackernél üres snapshot és 0 token', () => {
    const t = new UsageTracker();

    expect(t.snapshot()).toEqual([]);
    expect(t.totalTokens()).toBe(0);
  });
});

describe('toTokenBreakdown', () => {
  it('a snapshotból provider+fn+tokens sorokat és összeget képez', () => {
    const t = new UsageTracker();

    t.add('openai', 'text-embedding-3-small', UsageFn.embedding, 100);
    t.add('anthropic', 'claude-sonnet-4-6', UsageFn.agent, 40);

    const breakdown = toTokenBreakdown(t.snapshot());

    expect(breakdown.rows).toEqual([
      { provider: 'openai', fn: 'embedding', tokens: 100 },
      { provider: 'anthropic', fn: 'agent', tokens: 40 },
    ]);
    expect(breakdown.total).toBe(140);
  });

  it('üres bemenetre üres sorok és 0 összeg', () => {
    expect(toTokenBreakdown([])).toEqual({ rows: [], total: 0 });
  });
});
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy elhasal**

Run: `nvm use 22 && pnpm vitest run packages/rag/src/lib/providers/tests/usage.spec.ts`
Expected: FAIL — `toTokenBreakdown`/`UsageFn` nincs exportálva, illetve az `add` szignatúra nem stimmel.

- [ ] **Step 3: Írd meg a `usage.ts`-t a `fn` dimenzióval**

Cseréld a teljes `packages/rag/src/lib/providers/usage.ts` tartalmát erre:

```typescript
// A provider-hívások funkció-címkéi (egyetlen forrás; a valós providerek és a FakeProviders is
// ebből veszik a címkét, hogy ne driftelhessen szét). A `rag-answer` a grounded RAG-válasz, az
// `agent` az orchestrátor-modell (NL→SQL tool-use loop).
export const UsageFn = {
  embedding: 'embedding',
  hyde: 'hyde',
  rerank: 'rerank',
  answer: 'rag-answer',
  agent: 'agent',
} as const;

export type UsageFnName = (typeof UsageFn)[keyof typeof UsageFn];

export interface ProviderUsage {
  provider: string;
  model: string;
  fn: string;
  calls: number;
  tokens: number;
}

// Provider-hívások token-fogyasztásának gyűjtője (side-channel). Az éles provider-implementációk
// írják (a válaszban kapott usage alapján); a FakeProviders csak ha trackert kap. A kulcs
// `provider:fn`, így ugyanaz a provider más funkcióval (pl. anthropic hyde vs rag-answer) külön sor.
export class UsageTracker {
  private readonly byKey = new Map<string, ProviderUsage>();

  add(provider: string, model: string, fn: string, tokens: number): void {
    const key = `${provider}:${fn}`;
    const cur = this.byKey.get(key) ?? {
      provider,
      model,
      fn,
      calls: 0,
      tokens: 0,
    };

    cur.calls += 1;
    cur.tokens += tokens;
    this.byKey.set(key, cur);
  }

  snapshot(): ProviderUsage[] {
    return [...this.byKey.values()];
  }

  totalTokens(): number {
    return this.snapshot().reduce((sum, u) => sum + u.tokens, 0);
  }
}

// A megjelenítéshez levékonyított alak: soronként (provider, fn, tokens) + összeg. A CLI ezt
// rendereli (ask/chat és rag:index/golden is), az agent ezt adja vissza a tokenBreakdown-ben.
export interface TokenBreakdown {
  rows: { provider: string; fn: string; tokens: number }[];
  total: number;
}

export function toTokenBreakdown(usage: ProviderUsage[]): TokenBreakdown {
  const rows = usage.map((u) => ({
    provider: u.provider,
    fn: u.fn,
    tokens: u.tokens,
  }));

  const total = rows.reduce((sum, r) => sum + r.tokens, 0);

  return { rows, total };
}
```

- [ ] **Step 4: Futtasd az `usage.spec.ts`-t — most zöld**

Run: `nvm use 22 && pnpm vitest run packages/rag/src/lib/providers/tests/usage.spec.ts`
Expected: PASS (5 teszt).

### 1b. Címkék a valós providerekben + `FakeProviders` tracker-támogatás

- [ ] **Step 5: Bővítsd a `providers.spec.ts`-t (failing test)**

Told a fájl `describe('FakeProviders', ...)` blokkja UTÁN ezt az új blokkot (a meglévő teszteket hagyd változatlanul), és told hozzá a felső importhoz a `UsageTracker`-t:

Az import sort (`import { FakeProviders } from '../providers.js';`) cseréld erre:

```typescript
import { FakeProviders } from '../providers.js';
import { UsageTracker } from '../usage.js';
```

Majd a fájl végére, a `describe('FakeProviders', ...)` blokk után:

```typescript
describe('FakeProviders trackerrel', () => {
  it('tracker nélkül nem rögzít (visszafelé kompatibilis)', async () => {
    const p = new FakeProviders();

    await p.embed(['snake plant']);

    // Nincs mit ellenőrizni a trackeren; a lényeg, hogy a hívás tracker nélkül is lefut.
    expect((await p.embed(['x'])).length).toBe(1);
  });

  it('trackerrel az embed a `embedding` funkciót rögzíti', async () => {
    const tracker = new UsageTracker();
    const p = new FakeProviders(tracker);

    await p.embed(['snake plant water']);

    expect(tracker.snapshot().map((u) => u.fn)).toEqual(['embedding']);
  });

  it('trackerrel a hyde/rerank/answer a saját funkciócímkéjét rögzíti', async () => {
    const tracker = new UsageTracker();
    const p = new FakeProviders(tracker);

    await p.hyde('q');
    await p.rerank('q', ['a', 'b'], 2);
    await p.answer('sys', 'prompt');

    expect(tracker.snapshot().map((u) => u.fn)).toEqual([
      'hyde',
      'rerank',
      'rag-answer',
    ]);
  });
});
```

- [ ] **Step 6: Futtasd — elhasal**

Run: `nvm use 22 && pnpm vitest run packages/rag/src/lib/providers/tests/providers.spec.ts`
Expected: FAIL — a `FakeProviders` konstruktora nem fogad trackert, nem rögzít.

- [ ] **Step 7: Add hozzá a tracker-támogatást a `FakeProviders`-hez**

A `packages/rag/src/lib/providers/providers.ts` tetején az import blokkot bővítsd a `UsageFn`-nel. A meglévő:

```typescript
import type { UsageTracker } from './usage.js';
```

cseréld erre:

```typescript
import { UsageFn, type UsageTracker } from './usage.js';
```

Majd a `FakeProviders` osztályt bővítsd konstruktorral és minden metódusban egy `tracker?.add(...)` sorral. A `class FakeProviders implements Providers {` sor után szúrd be a konstruktort, és minden metódus elejére a rögzítést. A teljes osztály így néz ki (cseréld a meglévő `export class FakeProviders ... }` blokkot erre):

```typescript
export class FakeProviders implements Providers {
  constructor(private readonly tracker?: UsageTracker) {}

  async embed(texts: string[]): Promise<number[][]> {
    this.tracker?.add('openai', 'fake-embed', UsageFn.embedding, texts.length);

    return texts.map((t) => {
      const v = new Array(1536).fill(0);

      for (const tok of tokenize(t)) {
        let h = 0;

        for (let i = 0; i < tok.length; i++) {
          h = (h * 31 + tok.charCodeAt(i)) >>> 0;
        }

        v[h % 1536] += 1;
      }

      const norm = Math.hypot(...v) || 1;

      return v.map((x) => x / norm);
    });
  }

  async hyde(query: string): Promise<string> {
    this.tracker?.add('anthropic', 'fake-hyde', UsageFn.hyde, 1);

    return `Hypothetical answer about: ${query}`;
  }

  async rerank(
    query: string,
    docs: string[],
    topN: number,
  ): Promise<RerankHit[]> {
    this.tracker?.add('jina', 'fake-rerank', UsageFn.rerank, 1);

    const q = new Set(tokenize(query));

    return docs
      .map((d, index) => {
        const toks = tokenize(d);
        const overlap = toks.filter((t) => q.has(t)).length;

        return { index, score: overlap / (toks.length || 1) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  async answer(_system: string, prompt: string): Promise<string> {
    this.tracker?.add('anthropic', 'fake-answer', UsageFn.answer, 1);

    return `ANSWER: ${prompt.slice(0, 80)}`;
  }
}
```

- [ ] **Step 8: Címkézd a valós providereket a `UsageFn`-nel**

`packages/rag/src/lib/providers/openai-embeddings.ts` — az import blokkot bővítsd:

```typescript
import { UsageFn, type UsageTracker } from './usage.js';
```

és a `tracker?.add(...)` sort (17. sor) cseréld:

```typescript
tracker?.add('openai', cfg.embedModel, UsageFn.embedding, usage?.tokens ?? 0);
```

`packages/rag/src/lib/providers/anthropic-gen.ts` — az import blokkot bővítsd:

```typescript
import { UsageFn, type UsageTracker } from './usage.js';
```

a HyDE `add` sort (33.):

```typescript
tracker?.add('anthropic', cfg.hydeModel, UsageFn.hyde, totalTokens(usage));
```

és az answer `add` sort (51.):

```typescript
tracker?.add('anthropic', cfg.answerModel, UsageFn.answer, totalTokens(usage));
```

`packages/rag/src/lib/providers/jina-rerank.ts` — az import blokkot bővítsd:

```typescript
import { UsageFn, type UsageTracker } from './usage.js';
```

és az `add` sort (42.):

```typescript
tracker?.add(
  'jina',
  cfg.rerankModel,
  UsageFn.rerank,
  json.usage?.total_tokens ?? 0,
);
```

- [ ] **Step 9: Bővítsd a `retrieve.spec.ts`-t a tracker-átfűzés bizonyítására (failing test)**

A `packages/rag/src/lib/pipeline/tests/retrieve.spec.ts` felső importjait bővítsd a `UsageTracker`-rel:

```typescript
import { FakeProviders } from '../../providers/providers.js';
import { UsageTracker } from '../../providers/usage.js';
```

és told a `describe('retrieve', ...)` blokkba (a meglévő `it` után) ezt:

```typescript
it('full módban a providerekbe fűzött tracker rögzíti a hyde/embedding/rerank funkciókat', async () => {
  const store = new InMemoryStore();
  const tracker = new UsageTracker();
  const p = new FakeProviders(tracker);
  await seed(store, p);

  await retrieve(
    'holes in monstera leaves',
    { providers: p, store },
    { mode: 'full', topN: 5, topK: 2 },
  );

  const fns = tracker.snapshot().map((u) => u.fn);

  expect(fns).toContain('hyde');
  expect(fns).toContain('embedding');
  expect(fns).toContain('rerank');
});
```

Megjegyzés: a `seed()` a `p.embed`-et hívja (ez is rögzít a trackerbe), de a teszt csak a címkék JELENLÉTÉT nézi (`toContain`), a pontos hívásszámot nem — így a seed-beli embed nem zavar.

- [ ] **Step 10: Futtasd a bővített providers + retrieve teszteket — most zöld**

Run: `nvm use 22 && pnpm vitest run packages/rag/src/lib/providers/tests/providers.spec.ts packages/rag/src/lib/pipeline/tests/retrieve.spec.ts`
Expected: PASS.

- [ ] **Step 11: Futtasd a teljes RAG-csomag tesztjeit + typecheck**

Run: `nvm use 22 && pnpm vitest run packages/rag && pnpm nx typecheck rag`
Expected: PASS — a `fn` mező additív, a meglévő tesztek/`printUsage` nem törnek.

- [ ] **Step 12: Commit**

```bash
git add packages/rag
git commit -m "feat(rag): UsageTracker funkció-dimenzió + toTokenBreakdown, provider-címkék

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Tracker átfűzése az agenten, `tokenBreakdown` a visszatérésben

**Files:**

- Modify: `packages/core/src/lib/tools/agent-tools.ts`
- Modify: `packages/core/src/lib/agent/ask-agent.ts`
- Modify: `packages/core/src/lib/shared/logger.ts:5-14`
- Test: `packages/core/src/lib/agent/tests/ask-agent.spec.ts` (bővítés)

**Interfaces:**

- Consumes (Task 1): `UsageTracker`, `UsageFn`, `toTokenBreakdown`, `TokenBreakdown`, `createProviders(cfg, tracker?)`, `FakeProviders`.
- Produces:
  - `buildTools(collector: ToolCall[], tracker?: UsageTracker): ToolSet`.
  - `AgentResult = { answer: string; usage: { input_tokens: number; output_tokens: number }; tokenBreakdown: TokenBreakdown }`.
  - `ChatStream.done` feloldott alakja: `{ answer; usage; messages; tokenBreakdown }`.

### 2a. `buildTools` trackert fűz a RAG-providerekbe

- [ ] **Step 1: Módosítsd az `agent-tools.ts`-t — `makeLiveAnswer(tracker?)` + `buildTools(collector, tracker?)`**

Az import blokkban a `@plantbase/rag`-import bővítése a `UsageTracker` típussal. A meglévő:

```typescript
import {
  loadRagConfig,
  createProviders,
  PgStore,
  answerFromKnowledge,
} from '@plantbase/rag';
```

cseréld erre:

```typescript
import {
  loadRagConfig,
  createProviders,
  PgStore,
  answerFromKnowledge,
  type UsageTracker,
} from '@plantbase/rag';
```

A modul-szintű `const liveAnswer: AnswerFn = ... ;` blokkot (a `ragPool` deklaráció utáni rész) cseréld erre a factory-ra:

```typescript
// Éles AnswerFn-gyár: opcionálisan kap egy kérés-hatókörű UsageTracker-t, amit a RAG-providerekbe
// fűz (createProviders 2. arg) — így a searchKnowledge alatti embed/HyDE/rerank/answer tokenek is
// ugyanabba a trackerbe gyűlnek, mint az orchestrátoré. A config + PgStore minden híváskor friss,
// csak a READ-ONLY Pool singleton.
function makeLiveAnswer(tracker?: UsageTracker): AnswerFn {
  return (query: string) => {
    const cfg = loadRagConfig();

    if (!ragPool) {
      const connectionString = process.env.DATABASE_URL_READONLY;

      if (!connectionString) {
        throw new Error(
          'Hiányzik a DATABASE_URL_READONLY. Állítsd be a .env-ben.',
        );
      }

      ragPool = new Pool({ connectionString });
    }

    const deps = {
      providers: createProviders(cfg, tracker),
      store: new PgStore(ragPool),
    };

    return answerFromKnowledge(query, deps, {
      topN: cfg.topN,
      topK: cfg.topK,
      minRerankScore: cfg.minRerankScore,
    });
  };
}
```

A `buildTools` szignatúráját és a `searchKnowledge` sorát módosítsd:

```typescript
export function buildTools(
  collector: ToolCall[],
  tracker?: UsageTracker,
): ToolSet {
```

és a `searchKnowledge: buildSearchKnowledge(liveAnswer),` sort:

```typescript
    searchKnowledge: buildSearchKnowledge(makeLiveAnswer(tracker)),
```

- [ ] **Step 2: Typecheck a core-ra (a régi `usage` visszatérés még kompatibilis)**

Run: `nvm use 22 && pnpm nx typecheck core`
Expected: PASS — `buildTools` új opcionális paramétere nem töri a meglévő hívókat.

### 2b. `ask-agent.ts` — tracker + agent-sor + `tokenBreakdown`

- [ ] **Step 3: Írd meg a bővített `ask-agent` teszteket (failing tests)**

A `packages/core/src/lib/agent/tests/ask-agent.spec.ts` fájlt bővítsd. Először a fájl tetejére, a meglévő `vi.mock('ai', ...)` blokk UTÁN (de az `import { askAgent, ... }` ELÉ) told be a `@plantbase/rag` mockot:

```typescript
// A RAG-útvonalat mockoljuk: a createProviders a NEKI ÁTADOTT trackerbe rögzít (így bizonyítjuk,
// hogy az askAgert-beli tracker fűződik le a searchKnowledge-ig), az answerFromKnowledge grounded
// választ ad. A loadRagConfig/PgStore hálózat-mentes stub.
vi.mock('@plantbase/rag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plantbase/rag')>();

  return {
    ...actual,
    loadRagConfig: () => ({ topN: 5, topK: 3, minRerankScore: 0 }),
    PgStore: class {},
    createProviders: (
      _cfg: unknown,
      tracker?: import('@plantbase/rag').UsageTracker,
    ) => ({
      embed: async () => [[]],
      hyde: async (q: string) => q,
      rerank: async () => [],
      answer: async () => {
        tracker?.add('anthropic', 'fake-answer-model', 'rag-answer', 200);

        return 'Grounded válasz.';
      },
    }),
    answerFromKnowledge: async (
      query: string,
      deps: {
        providers: { answer: (s: string, p: string) => Promise<string> };
      },
    ) => {
      const answer = await deps.providers.answer('sys', query);

      return { answer, grounded: true, sources: [] };
    },
  };
});
```

Ezután a `describe('askAgent', ...)` blokk végére (az utolsó `it` után) told be a két új tesztet:

```typescript
it('RAG nélküli kérdésnél a tokenBreakdown csak az agent sort tartalmazza', async () => {
  generateTextMock.mockResolvedValue({
    text: 'Kész.',
    usage: { inputTokens: 99, outputTokens: 99 },
    totalUsage: { inputTokens: 10, outputTokens: 5 },
    response: { messages: [{ role: 'assistant', content: 'Kész.' }] },
  });

  const res = await askAgent('szia', {} as never);

  expect(res.tokenBreakdown.rows).toEqual([
    { provider: 'anthropic', fn: 'agent', tokens: 15 },
  ]);
  expect(res.tokenBreakdown.total).toBe(15);
});

it('a RAG-tokenek és az agent-token ugyanabba a breakdownba olvadnak', async () => {
  process.env.DATABASE_URL_READONLY = 'postgres://user:pass@localhost:5432/db';

  // A stubolt generateText lefuttatja a searchKnowledge toolt → a mockolt RAG a tracker
  // (rag-answer:200) sort rögzíti; az agent totalUsage (10+5) adja az agent sort.
  generateTextMock.mockImplementation(
    async (opts: {
      tools: ReturnType<typeof import('../../tools/agent-tools.js').buildTools>;
    }) => {
      await opts.tools.searchKnowledge.execute!({ query: 'hogyan öntözzem?' }, {
        toolCallId: 't',
        messages: [],
      } as never);

      return {
        text: 'Kész.',
        usage: { inputTokens: 1, outputTokens: 1 },
        totalUsage: { inputTokens: 10, outputTokens: 5 },
        response: { messages: [{ role: 'assistant', content: 'Kész.' }] },
      };
    },
  );

  const res = await askAgent('hogyan öntözzem a pothost?', {} as never);

  expect(res.tokenBreakdown.rows).toEqual([
    { provider: 'anthropic', fn: 'rag-answer', tokens: 200 },
    { provider: 'anthropic', fn: 'agent', tokens: 15 },
  ]);
  expect(res.tokenBreakdown.total).toBe(215);
});
```

- [ ] **Step 4: Futtasd — elhasal**

Run: `nvm use 22 && pnpm vitest run packages/core/src/lib/agent/tests/ask-agent.spec.ts`
Expected: FAIL — `res.tokenBreakdown` nincs (undefined).

- [ ] **Step 5: Írd meg az `ask-agent.ts` módosítását**

Az import blokk tetejét bővítsd a Task 1 exportjaival. A meglévő:

```typescript
import { buildTools, type ToolCall } from '../tools/agent-tools.js';
```

után told be:

```typescript
import {
  UsageTracker,
  UsageFn,
  toTokenBreakdown,
  type TokenBreakdown,
} from '@plantbase/rag';
```

Az `AgentResult` interfészt bővítsd:

```typescript
export interface AgentResult {
  answer: string;
  usage: { input_tokens: number; output_tokens: number };
  tokenBreakdown: TokenBreakdown;
}
```

Az `askAgent` törzsét módosítsd: hozz létre trackert, add át a `buildTools`-nak, a `generateText` után told be az agent-sort, építsd a breakdown-t, naplózd és add vissza. A `const collector: ToolCall[] = [];` sor után és a `generateText` hívásban:

```typescript
export async function askAgent(
  input: unknown,
  model: LanguageModel = resolveModel(),
): Promise<AgentResult> {
  const prompt = buildPrompt(input);
  const collector: ToolCall[] = [];
  const tracker = new UsageTracker();

  const result = await generateText({
    model,
    system: prompt.system,
    messages: prompt.messages,
    tools: buildTools(collector, tracker),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const usage = mapUsage(result.totalUsage);

  // Az orchestrátor-modell (NL→SQL tool-use loop) tokenjei `agent` funkcióként, ugyanabba a
  // trackerbe, mint a RAG-provider tokenek — így egy közös breakdown áll össze.
  tracker.add(
    'anthropic',
    modelId(model),
    UsageFn.agent,
    usage.input_tokens + usage.output_tokens,
  );

  const tokenBreakdown = toTokenBreakdown(tracker.snapshot());

  logInteraction({
    timestamp: new Date().toISOString(),
    model: modelId(model),
    system: prompt.system,
    messages: [...prompt.messages, ...result.response.messages],
    answer: result.text,
    usage,
    tokenBreakdown,
    sql: collector.map((c) => c.sql).join('\n'),
    result: collector.map((c) => c.rows),
  });

  return { answer: result.text, usage, tokenBreakdown };
}
```

A `ChatStream` interfész `done` alakját bővítsd:

```typescript
export interface ChatStream {
  textStream: AsyncIterable<string>;
  done: Promise<{
    answer: string;
    usage: AgentResult['usage'];
    messages: ChatMessage[];
    tokenBreakdown: TokenBreakdown;
  }>;
}
```

A `streamChat` törzsét módosítsd: a tracker a `streamText` ELŐTT jön létre (hogy a `buildTools` megkapja), a `done`-ban told be az agent-sort és a breakdown-t:

```typescript
export function streamChat(
  messages: ChatMessage[],
  model: LanguageModel = resolveModel(),
): ChatStream {
  const collector: ToolCall[] = [];
  const tracker = new UsageTracker();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildTools(collector, tracker),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const done = (async () => {
    const [answer, rawUsage, response] = await Promise.all([
      result.text,
      result.totalUsage,
      result.response,
    ]);

    const usage = mapUsage(rawUsage);

    tracker.add(
      'anthropic',
      modelId(model),
      UsageFn.agent,
      usage.input_tokens + usage.output_tokens,
    );

    const tokenBreakdown = toTokenBreakdown(tracker.snapshot());
    const fullMessages: ChatMessage[] = [...messages, ...response.messages];

    logInteraction({
      timestamp: new Date().toISOString(),
      model: modelId(model),
      system: SYSTEM_PROMPT,
      messages: fullMessages,
      answer,
      usage,
      tokenBreakdown,
      sql: collector.map((c) => c.sql).join('\n'),
      result: collector.map((c) => c.rows),
    });

    return { answer, usage, messages: fullMessages, tokenBreakdown };
  })();

  return { textStream: result.textStream, done };
}
```

- [ ] **Step 6: Add hozzá a `tokenBreakdown` mezőt a naplórekordhoz**

`packages/core/src/lib/shared/logger.ts` — az `InteractionLog` interfészbe (a `usage: unknown;` sor után) told be:

```typescript
  usage: unknown;
  tokenBreakdown?: unknown;
```

- [ ] **Step 7: Futtasd a bővített `ask-agent` teszteket — most zöld**

Run: `nvm use 22 && pnpm vitest run packages/core/src/lib/agent/tests/ask-agent.spec.ts`
Expected: PASS — a meglévő usage-tesztek és a két új breakdown-teszt is.

- [ ] **Step 8: Futtasd a teljes core-csomagot + typecheck**

Run: `nvm use 22 && pnpm vitest run packages/core && pnpm nx typecheck core`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): kérés-hatókörű UsageTracker az agenten, tokenBreakdown a válaszban

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: CLI — token-breakdown renderelése (ask + chat + rag:*)

**Files:**

- Create: `apps/cli/src/token-report.ts`
- Create: `apps/cli/src/token-report.spec.ts`
- Modify: `apps/cli/src/main.ts`

**Interfaces:**

- Consumes (Task 1 + 2): `TokenBreakdown`, `toTokenBreakdown` (`@plantbase/rag`); `askAgent` és `streamChat` `tokenBreakdown` mezője (`@plantbase/core`).
- Produces: `formatTokenBreakdown(breakdown: TokenBreakdown): string`.

### 3a. Tiszta formázó + teszt

- [ ] **Step 1: Írd meg a `token-report.spec.ts`-t (failing test)**

Hozd létre a `apps/cli/src/token-report.spec.ts` fájlt:

```typescript
import { describe, it, expect } from 'vitest';
import { formatTokenBreakdown } from './token-report.js';

describe('formatTokenBreakdown', () => {
  it('provider+fn soronként, plusz Összesen sor', () => {
    const out = formatTokenBreakdown({
      rows: [
        { provider: 'openai', fn: 'embedding', tokens: 1240 },
        { provider: 'anthropic', fn: 'rag-answer', tokens: 2110 },
        { provider: 'anthropic', fn: 'agent', tokens: 1540 },
      ],
      total: 4890,
    });

    expect(out).toContain('Token-használat');
    expect(out).toContain('embedding');
    expect(out).toContain('rag-answer');
    expect(out).toContain('agent');
    expect(out).toContain('Összesen');
    // Fejléc + 3 sor + elválasztó + összeg = 6 sor.
    expect(out.split('\n')).toHaveLength(6);
  });

  it('üres breakdownnál beszédes egysoros üzenet', () => {
    const out = formatTokenBreakdown({ rows: [], total: 0 });

    expect(out).toContain('nincs');
    expect(out.split('\n')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Futtasd — elhasal**

Run: `nvm use 22 && pnpm vitest run apps/cli/src/token-report.spec.ts`
Expected: FAIL — `./token-report.js` nem létezik.

- [ ] **Step 3: Írd meg a `token-report.ts`-t**

Hozd létre a `apps/cli/src/token-report.ts` fájlt:

```typescript
import type { TokenBreakdown } from '@plantbase/rag';

// A token-breakdown emberi olvasásra formázva (ask/chat és rag:index/golden is ezt használja).
// A számokat hu-HU szerint tagoljuk (a repó máshol is így), a provider/fn oszlopokat balra zárjuk.
export function formatTokenBreakdown(breakdown: TokenBreakdown): string {
  const num = (n: number): string => n.toLocaleString('hu-HU');

  if (breakdown.rows.length === 0) {
    return 'Token-használat: nincs (nem történt provider-hívás).';
  }

  const provW = Math.max(...breakdown.rows.map((r) => r.provider.length));
  const fnW = Math.max(...breakdown.rows.map((r) => r.fn.length));

  const lines = breakdown.rows.map(
    (r) =>
      `  ${r.provider.padEnd(provW)}  ${r.fn.padEnd(fnW)}  ${num(r.tokens)}`,
  );

  const sep = '  ' + '─'.repeat(provW + fnW + 4);
  const totalLine = `  ${'Összesen'.padEnd(provW + fnW + 2)}  ${num(breakdown.total)}`;

  return ['Token-használat', ...lines, sep, totalLine].join('\n');
}
```

- [ ] **Step 4: Futtasd — zöld**

Run: `nvm use 22 && pnpm vitest run apps/cli/src/token-report.spec.ts`
Expected: PASS (2 teszt).

### 3b. Bekötés az `ask` / `chat` / `rag:*` útvonalakba

- [ ] **Step 5: Kösd be a formázót a `main.ts`-be**

`apps/cli/src/main.ts` importok — a `@plantbase/rag` importból töröld a `ProviderUsage`-t (a `printUsage`-zsal együtt megszűnik), és told hozzá a `toTokenBreakdown`-t. A meglévő rag-import blokk:

```typescript
import {
  loadRagConfig,
  createProviders,
  PgStore,
  ingestDocs,
  runGolden,
  renderGoldenMarkdown,
  GOLDEN_QUESTIONS,
  UsageTracker,
  type IngestProgress,
  type GoldenProgress,
  type ProviderUsage,
} from '@plantbase/rag';
```

cseréld erre:

```typescript
import {
  loadRagConfig,
  createProviders,
  PgStore,
  ingestDocs,
  runGolden,
  renderGoldenMarkdown,
  GOLDEN_QUESTIONS,
  UsageTracker,
  toTokenBreakdown,
  type IngestProgress,
  type GoldenProgress,
} from '@plantbase/rag';
```

A `@plantbase/core`-import után (a fájl tetején) told be a helyi formázó importját:

```typescript
import { formatTokenBreakdown } from './token-report.js';
```

Töröld a teljes `printUsage` függvényt (a `function printUsage(...) { ... }` blokkot).

Az `answer()` függvényben az `askAgent` hívást és a kiírást bővítsd:

```typescript
const { answer: text, tokenBreakdown } = await askAgent(input);
console.log(text);
console.log(formatTokenBreakdown(tokenBreakdown));
```

A `runInteractive` `processTurn`-jében az `await done`-t bővítsd, és a `\n` utáni sorba told be a kiírást:

```typescript
process.stdout.write('\n');
const { messages, tokenBreakdown } = await done;
console.log(formatTokenBreakdown(tokenBreakdown));
history.splice(0, history.length, ...messages);
```

A `ragIndex`-ben a `printUsage(usage.snapshot(), usage.totalTokens());` sort cseréld:

```typescript
console.log(formatTokenBreakdown(toTokenBreakdown(usage.snapshot())));
```

A `ragGolden`-ben ugyanígy a `printUsage(usage.snapshot(), usage.totalTokens());` sort cseréld:

```typescript
console.log(formatTokenBreakdown(toTokenBreakdown(usage.snapshot())));
```

- [ ] **Step 6: Typecheck a cli-re (nincs használatlan import, minden típus stimmel)**

Run: `nvm use 22 && pnpm nx typecheck cli`
Expected: PASS — a `ProviderUsage`/`printUsage` eltűnt, nincs használatlan szimbólum.

- [ ] **Step 7: Futtasd a teljes CLI-teszteket**

Run: `nvm use 22 && pnpm vitest run apps/cli`
Expected: PASS — a token-report unit + a meglévő CLI-integráció (`--help`, exit) tovább zöld (nem hálózat-függő utak).

- [ ] **Step 8: Kézi füst-teszt — az `ask` a válasz alá kiírja a táblát**

Run (valós kulcsokkal, .env-ből): `nvm use 22 && pnpm cli ask "hogyan szaporítsam a pothost dugványról?"`
Expected: a természetes nyelvű válasz, majd alatta a `Token-használat` tábla `embedding`/`hyde`/`rerank`/`rag-answer`/`agent` sorokkal (a RAG-ot ténylegesen használó kérdésnél) és egy `Összesen` sorral. Tiszta NL→SQL kérdésnél csak az `agent` sor + `Összesen`.

- [ ] **Step 9: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): token-használat kiírása ask/chat után, közös formázó a rag:* riporttal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Végső ellenőrzés

- [ ] **Teljes teszt + typecheck az egész repón**

Run: `nvm use 22 && pnpm vitest run && pnpm nx run-many -t typecheck`
Expected: minden zöld.

- [ ] **Formázás**

Run: `nvm use 22 && pnpm prettier --write .`
Expected: nincs formázási diff a kézzel írt kódban (vagy a formázó rendezi).

---

## Self-Review jegyzet (a spec lefedettsége)

- Spec 1. szekció (fn dimenzió, UsageFn, rag:* tovább működik) → Task 1.
- Spec 2. szekció (down path: buildTools+createProviders tracker; up path: agent-sor; nem-breaking `usage` + új `tokenBreakdown`; naplózás) → Task 2.
- Spec 3. szekció (közös renderelő; ask + chat; RAG nélkül csak agent-sor) → Task 3.
- Spec 4. szekció (UsageTracker fn unit; provider-címkézés FakeProviders+tracker; agent-merge; tiszta CLI-formázó) → Task 1 (1a/1b tesztek), Task 2 (3. lépés tesztek), Task 3 (3a teszt).
