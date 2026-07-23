# Plantbase RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `docs/knowledge/` növény-tudásbázisból RAG-pipeline (HyDE + rerank + grounding, pgvector, multi-provider), `searchKnowledge` agent-toollal és golden-set bizonyítékkal.

**Architecture:** Új `@plantbase/rag` csomag három réteggel (ingestion / retrieval / grounding), injektálható provider-interfésszel (unit-tesztek kulcs nélkül futnak). Tárolás pgvectorban (`knowledge_chunks`), az agent RO-n olvas, az ingestion RW-n ír. Az agent a meglévő AI SDK tool-készletbe kap egy `searchKnowledge` toolt.

**Tech Stack:** TypeScript (ESM, NodeNext), AI SDK v5 (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`), `pg` + pgvector, Prisma (séma/migráció), Jina rerank (fetch), vitest, nx + pnpm.

> **Megjegyzés (post-implementáció):** a rerank-provider **Cohere → Jina** cserélve lett
> (`jina-reranker-v2-base-multilingual`), mert a Cohere enterprise-only, a Jina viszont ingyenes,
> azonnali self-serve kulccsal jár. A `Providers.rerank` interfész változatlan; a lenti Task 4 / Task 12
> kódrészletek és env-kulcsok, ahol még `Cohere`/`COHERE_API_KEY`/`api.cohere.com` szerepel, a
> `jina-rerank.ts` / `JINA_API_KEY` / `https://api.jina.ai/v1/rerank` megfelelővel értendők (lásd a
> friss `.env.example`-t és a specet).

## Global Constraints

- **Node 22 LTS**: minden pnpm/nx/vitest hívás előtt `nvm use 22` (a harness shell alapból node 20). `.nvmrc` = 22.
- **Git**: soha ne committolj közvetlenül `main`-re. A RAG-munka a `feat/rag-knowledge-base` ágon megy (Task 0 hozza létre, `main`-ről, a PR #13 merge után).
- **Commit**: magyar conventional commit (`feat:`, `fix:`, `test:`, `build:`, `docs:`), a Bash-eszköz elvárása szerint a törzs végén: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Provider-injektálás (DI)**: minden pipeline-függvény (`ingest`, `retrieve`, `answer`) `Providers` + `Store` paramétert kap; az éleset `config.ts` állítja össze env-ből, fail-fast **magyar** hibákkal. A unit-tesztek `FakeProviders`-t + in-memory store-t használnak → kulcs és hálózat nélkül futnak.
- **Embedding**: OpenAI `text-embedding-3-small`, **1536 dim**, koszinusz.
- **Nyelv**: a kód/tesztek angolul is oké, de a felhasználónak szánt szövegek (hibák, „nincs a tudásbázisban", grounded válasz) **magyarul**.
- **Fájlméret**: fókuszált fájlok, egy felelősség/fájl; `*.spec.ts` a forrás mellé.

---

## File Structure

**Új csomag — `packages/rag/`:**

- `package.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `vitest.config.mts`, `src/index.ts` — nx/pnpm csomag-scaffold (a `packages/core` mintájára).
- `src/lib/config.ts` — env → `RagConfig` (kulcsok, modell-id-k, küszöbök), fail-fast.
- `src/lib/markdown.ts` — `parseDoc` (frontmatter + törzs).
- `src/lib/chunker.ts` — `stripBoilerplate`, `extractRelated`, `resolveRelated`, `chunkDoc` (**a tesztelt egység**).
- `src/lib/providers.ts` — `Providers` interfész + `FakeProviders` (determinisztikus).
- `src/lib/openai-embeddings.ts`, `src/lib/cohere-rerank.ts`, `src/lib/anthropic-gen.ts` — éles provider-implementációk.
- `src/lib/store.ts` — `Store` interfész + `PgStore` (pgvector) + `InMemoryStore` (teszt).
- `src/lib/ingest.ts` — `ingestDocs` (fájl → chunk → embed → upsert, content-hash skip).
- `src/lib/retrieve.ts` — `retrieve` (raw + full: HyDE → embed → similarity → rerank).
- `src/lib/answer.ts` — `answerFromKnowledge` (grounding küszöb + forráshivatkozás).
- `src/lib/golden.ts` — golden-set kérdések + runner (raw vs full összevetés).

**Meglévő csomagok — módosítás:**

- `docker-compose.yml` — pgvector image.
- `packages/db/prisma/schema.prisma` + új migráció — `knowledge_chunks` tábla.
- `packages/core/src/lib/tools/search-knowledge.ts` (+spec) — új agent-tool.
- `packages/core/src/lib/tools/agent-tools.ts` — a tool regisztrálása.
- `packages/core/src/lib/system-prompt.ts` — grounding-szabályok.
- `packages/core/package.json` — `@plantbase/rag` dep.
- `apps/cli/src/main.ts` — `rag:index` és `rag:golden` parancsok.
- `.env.example` — új kulcsok.
- `docs/RAG/ARCHITEKTURA.md`, `docs/RAG/GOLDEN-SET.md` — dokumentumok.

---

## Task 0: Phase 0 — PR #13 feloldás → main, majd RAG-ág

**Nem TDD** — git-előkészítés. A cél: az AI SDK-alap main-re kerüljön (a spec 2. szakasza szerinti feloldással), majd tiszta `feat/rag-knowledge-base` ág. **A GitHub-oldali merge az egyetlen visszafordíthatatlan lépés — csak zöld tesztek után, és a felhasználónak megmutatva.**

**Files:** `packages/core/src/lib/**` (konfliktus-feloldás), `docker-compose.yml` érintetlen itt.

- [ ] **Step 1: Friss állapot + munkaág a branchről**

```bash
cd /Users/robertvarkonyi/Documents/AgentDev
git fetch origin
git checkout feat/ai-sdk-chat-agent
git pull --ff-only
git merge origin/main   # KONFLIKTUS várható — a következő lépés oldja fel
```

Expected: konfliktus a `packages/core/src/lib/ask-agent.ts`, `apps/cli/src/main.ts`, `ask-agent.spec.ts`, `logger.spec.ts`, `.claude/skills/new-agent-tool/SKILL.md`, `pnpm-lock.yaml` fájlokban + rename/add ütközések a `tools/` mappánál.

- [ ] **Step 2: Konfliktus-feloldás a spec 2. táblája szerint**

Cél-struktúra `packages/core/src/lib/` alatt:

```
ask-agent.ts        # AI SDK (branch) — streamChat + askAgent
provider.ts         # branch — resolveModel (multi-provider)
system-prompt.ts
logger.ts           # main + branch reconcile
errors.ts           # main-ből megtartva (+ errors.spec.ts)
tools/
  agent-tools.ts    # AI SDK buildTools → ToolSet (a branch agent-tools.ts-e ide kerül)
  run-sql.ts        # main tools/ helye, branch tartalommal
  list-categories.ts
  + *.spec.ts
```

Feloldási szabályok:

- `ask-agent.ts`, `main.ts`, `provider.ts`: **branch** verziót tartsd (`git checkout --theirs` ahol tiszta), AI SDK.
- `errors.ts` + `errors.spec.ts`: main-ből megtartva (jön a merge-ben addként).
- Mozgatás: `git mv packages/core/src/lib/run-sql.ts packages/core/src/lib/tools/run-sql.ts` és `list-categories.ts` ugyanígy (a branch flat helyükről a `tools/` alá); a spec-eket is.
- `agent-tools.ts`: a branch `packages/core/src/lib/agent-tools.ts`-ét mozgasd `tools/agent-tools.ts`-be; importjai `./run-sql.js`, `./list-categories.js` (a `tools/`-on belül relatív). A `toolError` delegáljon az `errors.ts` `errorMessage`-ére, ha kompatibilis; különben hagyd a meglévő `toolError`-t.
- `tools/registry.ts` + `registry.spec.ts` (main, Anthropic.Tool): **töröld** (`git rm`) — szerepét az AI SDK `agent-tools.ts` viszi.
- `packages/core/src/index.ts`: exportálja `ask-agent`, `provider`, `system-prompt`, `logger`, `errors`, `tools/agent-tools` (és amit a CLI használ). Ne exportálj törölt modult.
- `.claude/skills/new-agent-tool/SKILL.md`: a branch (AI SDK `tool()`) verzióját tartsd, de az útvonalakat igazítsd `packages/core/src/lib/tools/`-ra.
- `pnpm-lock.yaml`: ne kézzel javítsd — feloldás után `nvm use 22 && pnpm install` regenerálja.

- [ ] **Step 3: Telepítés + típus + teljes teszt-suite**

```bash
nvm use 22
pnpm install
npx nx run-many -t typecheck 2>/dev/null || npx nx run-many -t build
npx nx run-many -t test
```

Expected: minden zöld. Ha valamelyik spec az AI SDK/tools átrendezés miatt piros → javítsd az importokat/elérési utakat, amíg zöld.

- [ ] **Step 4: Merge-commit + push, majd a GitHub-oldali merge megerősítése**

```bash
git add -A
git commit -m "merge: origin/main a tools/registry+errors refaktorral; AI SDK marad az alap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin feat/ai-sdk-chat-agent
gh pr view 13 --json mergeable,mergeStateStatus
```

Expected: `MERGEABLE`. **Állj meg**, mutasd meg a felhasználónak, és csak jóváhagyás után:

```bash
gh pr merge 13 --merge
```

- [ ] **Step 5: RAG-ág main-ről + a spec commitolása**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/rag-knowledge-base
git add docs/superpowers/specs/2026-07-22-plantbase-rag-design.md docs/superpowers/plans/2026-07-22-plantbase-rag.md
git commit -m "docs: RAG spec + implementációs terv

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(A `docs/knowledge/` untracked marad; külön committoljuk a Task 6-ban vagy itt, ha akarod.)

---

## Task 1: pgvector infrastruktúra (docker image + Prisma migráció)

**Files:**

- Modify: `docker-compose.yml` (image)
- Modify: `packages/db/prisma/schema.prisma` (KnowledgeChunk model)
- Create: `packages/db/prisma/migrations/<ts>_knowledge_chunks/migration.sql`
- Modify: `.env.example`

**Interfaces:**

- Produces: `knowledge_chunks` tábla (lásd séma lent), elérhető a RO és RW kapcsolaton is.

- [ ] **Step 1: pgvector image**

`docker-compose.yml` — `image: postgres:17` → `image: pgvector/pgvector:pg17`. A friss extension-hez a konténer újraindul; a volume marad.

- [ ] **Step 2: Prisma model (Unsupported vector) + env**

`schema.prisma` végére:

```prisma
model KnowledgeChunk {
  id           BigInt   @id @default(autoincrement())
  doc_id       String
  doc_title    String
  doc_source   String
  doc_category String
  heading_path String
  chunk_index  Int
  content      String
  content_hash String
  related_docs String[] @default([])
  token_count  Int
  embedding    Unsupported("vector(1536)")
  embed_model  String
  indexed_at   DateTime @default(now())

  @@unique([doc_id, chunk_index])
  @@index([doc_id])
  @@map("knowledge_chunks")
}
```

`.env.example` bővítés:

```
# --- RAG providerek ---
OPENAI_API_KEY=sk-...
COHERE_API_KEY=...
OPENAI_EMBED_MODEL=text-embedding-3-small
COHERE_RERANK_MODEL=rerank-v3.5
ANTHROPIC_HYDE_MODEL=claude-haiku-4-5
ANTHROPIC_ANSWER_MODEL=claude-sonnet-4-6
RAG_MIN_RERANK_SCORE=0.30
RAG_TOP_N=20
RAG_TOP_K=5
```

- [ ] **Step 3: Migráció generálása + kézi kiegészítés (extension + HNSW + grant)**

```bash
nvm use 22
npx prisma migrate dev --name knowledge_chunks --create-only --schema packages/db/prisma/schema.prisma
```

A generált `migration.sql` **elejére**:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

és **végére** (a Prisma nem tud HNSW-t + a vector típust `bytea`-ként látná — cseréld a generált `embedding` oszlopdefiníciót `vector(1536)`-ra, ha kell), majd:

```sql
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
-- a RO role kapjon SELECT-et az új táblára (a default privileges gyakran elég, de biztosításként):
GRANT SELECT ON knowledge_chunks TO plantbase_ro;
```

- [ ] **Step 4: Migráció alkalmazása + smoke-ellenőrzés**

```bash
docker compose up -d db
nvm use 22
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
# extension + tábla + RO jog ellenőrzése:
docker exec -i plantbase-db psql -U plantbase -d plantbase -c "\dx vector" -c "\d knowledge_chunks"
```

Expected: `vector` extension listázva; a tábla oszlopai láthatók, `embedding` típusa `vector`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml packages/db/prisma .env.example
git commit -m "feat(db): pgvector + knowledge_chunks tábla (HNSW/cosine, RO SELECT)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `@plantbase/rag` csomag-scaffold + config

**Files:**

- Create: `packages/rag/package.json`, `tsconfig*.json`, `vitest.config.mts`, `src/index.ts`
- Create: `packages/rag/src/lib/config.ts`, `packages/rag/src/lib/config.spec.ts`

**Interfaces:**

- Produces: `interface RagConfig { openaiApiKey; cohereApiKey; anthropicApiKey; embedModel; rerankModel; hydeModel; answerModel; minRerankScore: number; topN: number; topK: number }` és `loadRagConfig(env = process.env): RagConfig`.

- [ ] **Step 1: Csomag-scaffold a `packages/core` mintájára**

`packages/rag/package.json` (a `packages/core/package.json` alapján), `type: module`, deps: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `pg`, `zod`; devDeps `@types/pg`. `tsconfig.lib.json`/`tsconfig.spec.json`/`vitest.config.mts` a core megfelelőit másolja. `src/index.ts` re-exportál a `./lib/*`-ból.

```bash
nvm use 22 && pnpm install
```

- [ ] **Step 2: Failing test — config fail-fast + defaultok**

`config.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadRagConfig } from './config.js';

const base = {
  OPENAI_API_KEY: 'o',
  COHERE_API_KEY: 'c',
  ANTHROPIC_API_KEY: 'a',
};

describe('loadRagConfig', () => {
  it('hiányzó OPENAI_API_KEY esetén beszédes magyar hibát dob', () => {
    expect(() => loadRagConfig({ ...base, OPENAI_API_KEY: '' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });
  it('alapértelmezett modelleket és küszöböket ad', () => {
    const c = loadRagConfig(base);
    expect(c.embedModel).toBe('text-embedding-3-small');
    expect(c.minRerankScore).toBe(0.3);
    expect(c.topN).toBe(20);
    expect(c.topK).toBe(5);
  });
  it('env felülírja a defaultokat', () => {
    const c = loadRagConfig({
      ...base,
      RAG_TOP_K: '8',
      RAG_MIN_RERANK_SCORE: '0.5',
    });
    expect(c.topK).toBe(8);
    expect(c.minRerankScore).toBe(0.5);
  });
});
```

- [ ] **Step 3: Run — FAIL**

```bash
nvm use 22 && npx nx test rag
```

Expected: FAIL („loadRagConfig is not a function").

- [ ] **Step 4: Implement `config.ts`**

```ts
export interface RagConfig {
  openaiApiKey: string;
  cohereApiKey: string;
  anthropicApiKey: string;
  embedModel: string;
  rerankModel: string;
  hydeModel: string;
  answerModel: string;
  minRerankScore: number;
  topN: number;
  topK: number;
}
function req(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Hiányzik a ${key}. Állítsd be a .env fájlban.`);
  return v;
}
function num(
  env: Record<string, string | undefined>,
  key: string,
  dflt: number,
): number {
  const v = env[key];
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`A ${key} nem szám: ${v}`);
  return n;
}
export function loadRagConfig(
  env: Record<string, string | undefined> = process.env,
): RagConfig {
  return {
    openaiApiKey: req(env, 'OPENAI_API_KEY'),
    cohereApiKey: req(env, 'COHERE_API_KEY'),
    anthropicApiKey: req(env, 'ANTHROPIC_API_KEY'),
    embedModel: env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    rerankModel: env.COHERE_RERANK_MODEL || 'rerank-v3.5',
    hydeModel: env.ANTHROPIC_HYDE_MODEL || 'claude-haiku-4-5',
    answerModel: env.ANTHROPIC_ANSWER_MODEL || 'claude-sonnet-4-6',
    minRerankScore: num(env, 'RAG_MIN_RERANK_SCORE', 0.3),
    topN: num(env, 'RAG_TOP_N', 20),
    topK: num(env, 'RAG_TOP_K', 5),
  };
}
```

- [ ] **Step 5: Run — PASS + commit**

```bash
nvm use 22 && npx nx test rag
git add packages/rag pnpm-lock.yaml
git commit -m "feat(rag): csomag-scaffold + config (fail-fast env)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Markdown-parse + chunker (a tesztelt egység)

**Files:**

- Create: `packages/rag/src/lib/markdown.ts`
- Create: `packages/rag/src/lib/chunker.ts`, `packages/rag/src/lib/chunker.spec.ts`

**Interfaces:**

- Produces:
  - `interface ParsedDoc { docId: string; title: string; source: string; category: string; body: string }`
  - `parseDoc(raw: string, docId: string): ParsedDoc`
  - `stripBoilerplate(body: string): string`
  - `extractRelated(body: string): string[]`
  - `resolveRelated(titles: string[], titleToDocId: Map<string, string>): string[]`
  - `interface Chunk { docId; title; source; category; headingPath: string; chunkIndex: number; content: string; tokenCount: number }`
  - `chunkDoc(doc: ParsedDoc, opts?: { maxChars?: number; minChars?: number }): Chunk[]`
  - `estimateTokens(s: string): number` (≈ `ceil(len/4)`)

- [ ] **Step 1: Failing tests (`chunker.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import {
  parseDoc,
  stripBoilerplate,
  extractRelated,
  resolveRelated,
  chunkDoc,
} from './chunker.js';

const RAW = `---
title: How To Care for a Monstera
source: https://example.com/monstera
category: plants-101
---

# How To Care for a Monstera

## Light
Monstera likes bright indirect light. Learn more here.

## Water
Water when the top inch is dry.

### Learn More
* How To Care for a Snake Plant
* Nonexistent Article

## Perfect Pairings For Your Plants
* Premium Potting Mix From $19

##### Words By The Sill
Empowering all people...`;

describe('parseDoc', () => {
  it('frontmattert és törzset bont', () => {
    const d = parseDoc(RAW, 'plants-101__how-to-care-for-a-monstera');
    expect(d.title).toBe('How To Care for a Monstera');
    expect(d.source).toBe('https://example.com/monstera');
    expect(d.category).toBe('plants-101');
    expect(d.body).toContain('## Light');
  });
});

describe('stripBoilerplate', () => {
  it('kivágja a Perfect Pairings / Words By The Sill / Learn More blokkokat', () => {
    const s = stripBoilerplate(parseDoc(RAW, 'x').body);
    expect(s).not.toMatch(/Perfect Pairings/);
    expect(s).not.toMatch(/Words By The Sill/);
    expect(s).not.toMatch(/Learn More/);
    expect(s).toMatch(/bright indirect light/);
  });
});

describe('extractRelated + resolveRelated', () => {
  it('kinyeri a Learn More címeket és feloldja a létezőket', () => {
    const titles = extractRelated(parseDoc(RAW, 'x').body);
    expect(titles).toEqual([
      'How To Care for a Snake Plant',
      'Nonexistent Article',
    ]);
    const map = new Map([
      ['how to care for a snake plant', 'plants-101__snake'],
    ]);
    expect(resolveRelated(titles, map)).toEqual(['plants-101__snake']); // ismeretlent kihagy
  });
  it('üres, ha nincs Learn More', () => {
    expect(extractRelated('## Light\nx')).toEqual([]);
  });
});

describe('chunkDoc', () => {
  const doc = parseDoc(RAW, 'plants-101__how-to-care-for-a-monstera');
  it('heading-path prefixet tesz minden chunk elé', () => {
    const chunks = chunkDoc(doc);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content.startsWith(`${doc.title} — `)).toBe(true);
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });
  it('a Light szekció chunkja tartalmazza a heading-patht', () => {
    const light = chunkDoc(doc).find((c) => c.headingPath.includes('Light'));
    expect(light).toBeTruthy();
    expect(light!.content).toContain('bright indirect light');
  });
  it('nagy szekciót maxChars alatti chunkokra vág, overlappal', () => {
    const big = parseDoc(
      `---\ntitle: T\nsource: s\ncategory: c\n---\n## H\n` +
        Array.from(
          { length: 30 },
          (_, i) => `Paragraph number ${i} with some filler text.`,
        ).join('\n\n'),
      'big',
    );
    const chunks = chunkDoc(big, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks)
      expect(c.content.length).toBeLessThanOrEqual(400 + 200); // prefix + overlap tolerancia
  });
  it('üres törzs → nincs chunk', () => {
    expect(
      chunkDoc(parseDoc(`---\ntitle: T\nsource: s\ncategory: c\n---\n`, 'e')),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
nvm use 22 && npx nx test rag -- chunker
```

Expected: FAIL (modul/függvény hiányzik).

- [ ] **Step 3: Implement `markdown.ts` + `chunker.ts`**

`markdown.ts`:

```ts
export interface ParsedDoc {
  docId: string;
  title: string;
  source: string;
  category: string;
  body: string;
}

export function parseDoc(raw: string, docId: string): ParsedDoc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = m ? m[1] : '';
  const body = m ? m[2] : raw;
  const get = (k: string) =>
    (fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim();
  return {
    docId,
    title: get('title'),
    source: get('source'),
    category: get('category'),
    body,
  };
}
```

`chunker.ts`:

```ts
import { parseDoc, type ParsedDoc } from './markdown.js';
export { parseDoc, type ParsedDoc } from './markdown.js';

export interface Chunk {
  docId: string;
  title: string;
  source: string;
  category: string;
  headingPath: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

// A Perfect Pairings szekciótól a fájl végéig minden upsell/footer; a Learn More blokk is navigáció.
export function stripBoilerplate(body: string): string {
  let out = body;
  out = out.replace(/^#{1,6}\s*Perfect Pairings[\s\S]*$/im, '');
  out = out.replace(/^#{1,6}\s*Words By The Sill[\s\S]*$/im, '');
  out = out.replace(
    /^#{1,6}\s*Learn More[\s\S]*?(?=^#{1,6}\s|(?![\s\S]))/gim,
    '',
  );
  out = out.replace(/^\s*Shop .*!\s*$/gim, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function extractRelated(body: string): string[] {
  const block = body.match(
    /^#{1,6}\s*Learn More\s*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im,
  );
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((l) => l.replace(/^\s*[*-]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

export function resolveRelated(
  titles: string[],
  titleToDocId: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const t of titles) {
    const id = titleToDocId.get(t.toLowerCase().trim());
    if (id) out.push(id);
  }
  return out;
}

interface Section {
  headingPath: string;
  text: string;
}

// A törzset heading-szekciókra bontja, heading-path stack-kel (## > ### > ####).
function splitSections(body: string): Section[] {
  const lines = body.split('\n');
  const stack: { level: number; title: string }[] = [];
  const sections: Section[] = [];
  let buf: string[] = [];
  const path = () => stack.map((s) => s.title).join(' > ');
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) sections.push({ headingPath: path(), text });
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level)
        stack.pop();
      stack.push({ level, title: h[2].trim() });
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

// Bekezdés-határon pakol maxChars-ig, 1 bekezdés overlappal; nem lép át szekció-határt.
export function chunkDoc(
  doc: ParsedDoc,
  opts?: { maxChars?: number; minChars?: number },
): Chunk[] {
  const maxChars = opts?.maxChars ?? 1600; // ~400 token
  const clean = stripBoilerplate(doc.body);
  const sections = splitSections(clean);
  const chunks: Chunk[] = [];
  let index = 0;
  const push = (headingPath: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    const prefix = `${doc.title}${headingPath ? ` — ${headingPath}` : ''}\n\n`;
    const content = prefix + body;
    chunks.push({
      docId: doc.docId,
      title: doc.title,
      source: doc.source,
      category: doc.category,
      headingPath,
      chunkIndex: index++,
      content,
      tokenCount: estimateTokens(content),
    });
  };
  for (const sec of sections) {
    const paras = sec.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    let buf: string[] = [];
    let len = 0;
    for (const p of paras) {
      if (len > 0 && len + p.length > maxChars) {
        push(sec.headingPath, buf.join('\n\n'));
        const overlap = buf[buf.length - 1] ?? '';
        buf = [overlap];
        len = overlap.length;
      }
      buf.push(p);
      len += p.length + 2;
    }
    if (buf.join('').trim()) push(sec.headingPath, buf.join('\n\n'));
  }
  return chunks;
}
```

- [ ] **Step 4: Run — PASS**

```bash
nvm use 22 && npx nx test rag -- chunker
```

Expected: PASS (mind).

- [ ] **Step 5: Commit**

```bash
git add packages/rag/src/lib/markdown.ts packages/rag/src/lib/chunker.ts packages/rag/src/lib/chunker.spec.ts
git commit -m "feat(rag): markdown-parse + header-tudatos, kontextualizált chunker cross-ref kinyeréssel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Providers interfész + fake + éles implementációk

**Files:**

- Create: `packages/rag/src/lib/providers.ts`, `providers.spec.ts`
- Create: `packages/rag/src/lib/openai-embeddings.ts`, `cohere-rerank.ts`, `anthropic-gen.ts`

**Interfaces:**

- Produces:
  - `interface RerankHit { index: number; score: number }`
  - `interface Providers { embed(texts: string[]): Promise<number[][]>; hyde(query: string): Promise<string>; rerank(query: string, docs: string[], topN: number): Promise<RerankHit[]>; answer(system: string, prompt: string): Promise<string> }`
  - `class FakeProviders implements Providers` — determinisztikus (hash-embedding, kulcsszó-átfedéses fake rerank, echo answer/hyde).
  - `createProviders(cfg: RagConfig): Providers` — éles (OpenAI + Cohere + Anthropic).

- [ ] **Step 1: Failing test (`providers.spec.ts`) — a FakeProviders szerződése**

```ts
import { describe, it, expect } from 'vitest';
import { FakeProviders } from './providers.js';

describe('FakeProviders', () => {
  const p = new FakeProviders();
  it('embed: azonos szöveg → azonos vektor, fix dimenzió', async () => {
    const [a, b] = await p.embed(['snake plant water', 'snake plant water']);
    expect(a).toEqual(b);
    expect(a.length).toBe(1536);
  });
  it('rerank: a query-szavakat jobban fedő doksi kap magasabb score-t, csökkenő sorrend', async () => {
    const hits = await p.rerank(
      'snake plant light',
      ['about fertilizer schedules', 'snake plant needs bright light'],
      2,
    );
    expect(hits[0].index).toBe(1);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });
  it('hyde: nem üres, tartalmazza a query-t', async () => {
    expect((await p.hyde('how to water snake plant')).length).toBeGreaterThan(
      0,
    );
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `providers.ts`**

```ts
import type { RagConfig } from './config.js';
import { embedFromOpenAI } from './openai-embeddings.js';
import { rerankFromCohere } from './cohere-rerank.js';
import { hydeFromAnthropic, answerFromAnthropic } from './anthropic-gen.js';

export interface RerankHit {
  index: number;
  score: number;
}
export interface Providers {
  embed(texts: string[]): Promise<number[][]>;
  hyde(query: string): Promise<string>;
  rerank(query: string, docs: string[], topN: number): Promise<RerankHit[]>;
  answer(system: string, prompt: string): Promise<string>;
}

const tokenize = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export class FakeProviders implements Providers {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(1536).fill(0);
      for (const tok of tokenize(t)) {
        let h = 0;
        for (let i = 0; i < tok.length; i++)
          h = (h * 31 + tok.charCodeAt(i)) >>> 0;
        v[h % 1536] += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
  async hyde(query: string): Promise<string> {
    return `Hypothetical answer about: ${query}`;
  }
  async rerank(
    query: string,
    docs: string[],
    topN: number,
  ): Promise<RerankHit[]> {
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
    return `ANSWER: ${prompt.slice(0, 80)}`;
  }
}

export function createProviders(cfg: RagConfig): Providers {
  return {
    embed: (texts) => embedFromOpenAI(cfg, texts),
    hyde: (query) => hydeFromAnthropic(cfg, query),
    rerank: (query, docs, topN) => rerankFromCohere(cfg, query, docs, topN),
    answer: (system, prompt) => answerFromAnthropic(cfg, system, prompt),
  };
}
```

- [ ] **Step 4: Éles implementációk (a golden-set futáshoz; unit-teszt csak a fake-et fedi)**

`openai-embeddings.ts`:

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import type { RagConfig } from './config.js';

export async function embedFromOpenAI(
  cfg: RagConfig,
  texts: string[],
): Promise<number[][]> {
  const openai = createOpenAI({ apiKey: cfg.openaiApiKey });
  const { embeddings } = await embedMany({
    model: openai.embedding(cfg.embedModel),
    values: texts,
  });
  return embeddings;
}
```

`cohere-rerank.ts`:

```ts
import type { RagConfig } from './config.js';
import type { RerankHit } from './providers.js';

export async function rerankFromCohere(
  cfg: RagConfig,
  query: string,
  docs: string[],
  topN: number,
): Promise<RerankHit[]> {
  if (docs.length === 0) return [];
  const res = await fetch('https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.cohereApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.rerankModel,
      query,
      documents: docs,
      top_n: Math.min(topN, docs.length),
    }),
  });
  if (!res.ok)
    throw new Error(`Cohere rerank hiba: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    results: { index: number; relevance_score: number }[];
  };
  return json.results.map((r) => ({
    index: r.index,
    score: r.relevance_score,
  }));
}
```

`anthropic-gen.ts`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { RagConfig } from './config.js';

const HYDE_SYSTEM =
  'You write a short, factual hypothetical passage (3-5 sentences) that would answer the question, ' +
  'as if excerpted from a houseplant care article. Write in English. No preamble.';

export async function hydeFromAnthropic(
  cfg: RagConfig,
  query: string,
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  const { text } = await generateText({
    model: anthropic(cfg.hydeModel),
    system: HYDE_SYSTEM,
    prompt: query,
  });
  return text;
}

export async function answerFromAnthropic(
  cfg: RagConfig,
  system: string,
  prompt: string,
): Promise<string> {
  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  const { text } = await generateText({
    model: anthropic(cfg.answerModel),
    system,
    prompt,
  });
  return text;
}
```

- [ ] **Step 5: Run — PASS + commit**

```bash
nvm use 22 && npx nx test rag -- providers
git add packages/rag/src/lib/providers.ts packages/rag/src/lib/providers.spec.ts packages/rag/src/lib/openai-embeddings.ts packages/rag/src/lib/cohere-rerank.ts packages/rag/src/lib/anthropic-gen.ts
git commit -m "feat(rag): Providers interfész (OpenAI embed / Cohere rerank / Anthropic HyDE+válasz) + FakeProviders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Store — pgvector + in-memory

**Files:**

- Create: `packages/rag/src/lib/store.ts`, `store.spec.ts`

**Interfaces:**

- Produces:
  - `interface StoredChunk extends Chunk { embedding: number[]; embedModel: string; relatedDocs: string[]; contentHash: string }`
  - `interface SearchHit { docId; title; source; category; headingPath; content; distance: number }`
  - `interface Store { upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void>; similaritySearch(embedding: number[], topN: number): Promise<SearchHit[]>; deleteByDocId(docId: string): Promise<void>; docHashes(): Promise<Map<string, string>> }`
  - `class InMemoryStore implements Store` (koszinusz-táv), `class PgStore implements Store` (pg).
  - `toVectorLiteral(v: number[]): string` → `'[0.1,0.2,...]'`.

- [ ] **Step 1: Failing test (`store.spec.ts`) — InMemoryStore + vektor-literál**

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryStore, toVectorLiteral } from './store.js';
import type { StoredChunk } from './store.js';

const chunk = (
  docId: string,
  content: string,
  embedding: number[],
): StoredChunk => ({
  docId,
  title: docId,
  source: `src/${docId}`,
  category: 'c',
  headingPath: '',
  chunkIndex: 0,
  content,
  tokenCount: 1,
  embedding,
  embedModel: 'fake',
  relatedDocs: [],
  contentHash: 'h',
});

describe('toVectorLiteral', () => {
  it('pgvector-literált ad', () =>
    expect(toVectorLiteral([1, 0.5])).toBe('[1,0.5]'));
});

describe('InMemoryStore', () => {
  it('similaritySearch a legközelebbi vektort adja elöl', async () => {
    const s = new InMemoryStore();
    await s.upsertDoc('a', [chunk('a', 'apple', [1, 0, 0])]);
    await s.upsertDoc('b', [chunk('b', 'banana', [0, 1, 0])]);
    const hits = await s.similaritySearch([0.9, 0.1, 0], 2);
    expect(hits[0].docId).toBe('a');
  });
  it('upsertDoc ugyanarra a docId-ra cserél (nem duplikál)', async () => {
    const s = new InMemoryStore();
    await s.upsertDoc('a', [chunk('a', 'v1', [1, 0, 0])]);
    await s.upsertDoc('a', [chunk('a', 'v2', [1, 0, 0])]);
    const hits = await s.similaritySearch([1, 0, 0], 5);
    expect(hits.filter((h) => h.docId === 'a').length).toBe(1);
    expect(hits[0].content).toBe('v2');
  });
  it('deleteByDocId + docHashes', async () => {
    const s = new InMemoryStore();
    await s.upsertDoc('a', [chunk('a', 'x', [1, 0, 0])]);
    expect((await s.docHashes()).get('a')).toBe('h');
    await s.deleteByDocId('a');
    expect((await s.docHashes()).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `store.ts`**

```ts
import { Pool } from 'pg';
import type { Chunk } from './chunker.js';

export interface StoredChunk extends Chunk {
  embedding: number[];
  embedModel: string;
  relatedDocs: string[];
  contentHash: string;
}
export interface SearchHit {
  docId: string;
  title: string;
  source: string;
  category: string;
  headingPath: string;
  content: string;
  distance: number;
}
export interface Store {
  upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void>;
  similaritySearch(embedding: number[], topN: number): Promise<SearchHit[]>;
  deleteByDocId(docId: string): Promise<void>;
  docHashes(): Promise<Map<string, string>>;
}

export const toVectorLiteral = (v: number[]): string => `[${v.join(',')}]`;
const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

export class InMemoryStore implements Store {
  private byDoc = new Map<string, StoredChunk[]>();
  async upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void> {
    this.byDoc.set(docId, chunks);
  }
  async deleteByDocId(docId: string): Promise<void> {
    this.byDoc.delete(docId);
  }
  async docHashes(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    for (const [id, cs] of this.byDoc) if (cs[0]) m.set(id, cs[0].contentHash);
    return m;
  }
  async similaritySearch(
    embedding: number[],
    topN: number,
  ): Promise<SearchHit[]> {
    const all: SearchHit[] = [];
    for (const cs of this.byDoc.values())
      for (const c of cs)
        all.push({
          docId: c.docId,
          title: c.title,
          source: c.source,
          category: c.category,
          headingPath: c.headingPath,
          content: c.content,
          distance: cosineDistance(embedding, c.embedding),
        });
    return all.sort((a, b) => a.distance - b.distance).slice(0, topN);
  }
}

export class PgStore implements Store {
  constructor(private pool: Pool) {}
  async upsertDoc(docId: string, chunks: StoredChunk[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM knowledge_chunks WHERE doc_id = $1', [
        docId,
      ]);
      for (const c of chunks) {
        await client.query(
          `INSERT INTO knowledge_chunks
             (doc_id, doc_title, doc_source, doc_category, heading_path, chunk_index,
              content, content_hash, related_docs, token_count, embedding, embed_model)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector,$12)`,
          [
            c.docId,
            c.title,
            c.source,
            c.category,
            c.headingPath,
            c.chunkIndex,
            c.content,
            c.contentHash,
            c.relatedDocs,
            c.tokenCount,
            toVectorLiteral(c.embedding),
            c.embedModel,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async deleteByDocId(docId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_chunks WHERE doc_id = $1', [
      docId,
    ]);
  }
  async docHashes(): Promise<Map<string, string>> {
    const r = await this.pool.query<{ doc_id: string; content_hash: string }>(
      'SELECT DISTINCT ON (doc_id) doc_id, content_hash FROM knowledge_chunks ORDER BY doc_id, chunk_index',
    );
    return new Map(r.rows.map((row) => [row.doc_id, row.content_hash]));
  }
  async similaritySearch(
    embedding: number[],
    topN: number,
  ): Promise<SearchHit[]> {
    const r = await this.pool.query(
      `SELECT doc_id, doc_title, doc_source, doc_category, heading_path, content,
              embedding <=> $1::vector AS distance
         FROM knowledge_chunks ORDER BY embedding <=> $1::vector LIMIT $2`,
      [toVectorLiteral(embedding), topN],
    );
    return r.rows.map((row: any) => ({
      docId: row.doc_id,
      title: row.doc_title,
      source: row.doc_source,
      category: row.doc_category,
      headingPath: row.heading_path,
      content: row.content,
      distance: Number(row.distance),
    }));
  }
}
```

- [ ] **Step 4: Run — PASS + commit**

```bash
nvm use 22 && npx nx test rag -- store
git add packages/rag/src/lib/store.ts packages/rag/src/lib/store.spec.ts
git commit -m "feat(rag): Store (PgStore pgvector + InMemoryStore) upsert/search/delete/hashes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Ingest pipeline (content-hash skip)

**Files:**

- Create: `packages/rag/src/lib/ingest.ts`, `ingest.spec.ts`

**Interfaces:**

- Consumes: `parseDoc`, `chunkDoc`, `extractRelated`, `resolveRelated` (Task 3); `Providers` (Task 4); `Store`, `StoredChunk` (Task 5).
- Produces:
  - `hashBody(body: string): string` (sha256 hex)
  - `interface IngestResult { indexed: number; skipped: number; deleted: number }`
  - `ingestDocs(files: { docId: string; raw: string }[], deps: { providers: Providers; store: Store; embedModel: string }): Promise<IngestResult>`

- [ ] **Step 1: Failing test (`ingest.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { ingestDocs } from './ingest.js';
import { FakeProviders } from './providers.js';
import { InMemoryStore } from './store.js';

const FM = (t: string, b: string) =>
  `---\ntitle: ${t}\nsource: s/${t}\ncategory: c\n---\n## H\n${b}`;

describe('ingestDocs', () => {
  it('beindexeli az összes doksit, majd változatlanul újrafuttatva mind skip', async () => {
    const files = [
      { docId: 'a', raw: FM('A', 'apple text') },
      { docId: 'b', raw: FM('B', 'banana text') },
    ];
    const deps = {
      providers: new FakeProviders(),
      store: new InMemoryStore(),
      embedModel: 'fake',
    };
    const r1 = await ingestDocs(files, deps);
    expect(r1.indexed).toBe(2);
    const r2 = await ingestDocs(files, deps);
    expect(r2.skipped).toBe(2);
    expect(r2.indexed).toBe(0);
  });
  it('törli a filesystemből eltűnt doksi chunkjait', async () => {
    const store = new InMemoryStore();
    const deps = { providers: new FakeProviders(), store, embedModel: 'fake' };
    await ingestDocs(
      [
        { docId: 'a', raw: FM('A', 'x') },
        { docId: 'b', raw: FM('B', 'y') },
      ],
      deps,
    );
    const r = await ingestDocs([{ docId: 'a', raw: FM('A', 'x') }], deps); // 'b' eltűnt
    expect(r.deleted).toBe(1);
    expect((await store.docHashes()).has('b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `ingest.ts`**

```ts
import { createHash } from 'node:crypto';
import { parseDoc } from './markdown.js';
import { chunkDoc, extractRelated, resolveRelated } from './chunker.js';
import type { Providers } from './providers.js';
import type { Store, StoredChunk } from './store.js';

export const hashBody = (body: string): string =>
  createHash('sha256').update(body).digest('hex');

export interface IngestResult {
  indexed: number;
  skipped: number;
  deleted: number;
}

export async function ingestDocs(
  files: { docId: string; raw: string }[],
  deps: { providers: Providers; store: Store; embedModel: string },
): Promise<IngestResult> {
  const { providers, store, embedModel } = deps;
  const existing = await store.docHashes();
  const titleToDocId = new Map<string, string>();
  const parsed = files.map((f) => {
    const doc = parseDoc(f.raw, f.docId);
    titleToDocId.set(doc.title.toLowerCase().trim(), f.docId);
    return { file: f, doc };
  });

  let indexed = 0,
    skipped = 0,
    deleted = 0;
  const present = new Set(files.map((f) => f.docId));
  for (const docId of existing.keys())
    if (!present.has(docId)) {
      await store.deleteByDocId(docId);
      deleted++;
    }

  for (const { doc } of parsed) {
    const hash = hashBody(doc.body);
    if (existing.get(doc.docId) === hash) {
      skipped++;
      continue;
    }
    const relatedDocs = resolveRelated(extractRelated(doc.body), titleToDocId);
    const chunks = chunkDoc(doc);
    if (chunks.length === 0) {
      skipped++;
      continue;
    }
    const embeddings = await providers.embed(chunks.map((c) => c.content));
    const stored: StoredChunk[] = chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
      embedModel,
      relatedDocs,
      contentHash: hash,
    }));
    await store.upsertDoc(doc.docId, stored);
    indexed++;
  }
  return { indexed, skipped, deleted };
}
```

- [ ] **Step 4: Run — PASS + commit**

```bash
nvm use 22 && npx nx test rag -- ingest
git add packages/rag/src/lib/ingest.ts packages/rag/src/lib/ingest.spec.ts
git commit -m "feat(rag): ingest pipeline content-hash skippel és törölt-doksi reconcile-lal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Retrieve — raw vs full (HyDE + rerank)

**Files:**

- Create: `packages/rag/src/lib/retrieve.ts`, `retrieve.spec.ts`

**Interfaces:**

- Consumes: `Providers` (Task 4), `Store`, `SearchHit` (Task 5).
- Produces:
  - `interface RetrievedChunk { docId; title; source; category; headingPath; content; distance: number; rerankScore?: number }`
  - `retrieve(query: string, deps: { providers: Providers; store: Store }, opts: { mode: 'raw' | 'full'; topN: number; topK: number }): Promise<RetrievedChunk[]>`

- [ ] **Step 1: Failing test (`retrieve.spec.ts`) — a full mód rerankje átrendez a raw-hoz képest**

```ts
import { describe, it, expect } from 'vitest';
import { retrieve } from './retrieve.js';
import { FakeProviders } from './providers.js';
import { InMemoryStore } from './store.js';
import type { StoredChunk } from './store.js';

async function seed(store: InMemoryStore, p: FakeProviders) {
  const docs = [
    {
      id: 'generic',
      text: 'monstera general care watering light soil repotting fertilizer',
    },
    { id: 'holes', text: 'why monstera leaves have holes fenestration splits' },
  ];
  for (const d of docs) {
    const [emb] = await p.embed([d.text]);
    const c: StoredChunk = {
      docId: d.id,
      title: d.id,
      source: `s/${d.id}`,
      category: 'c',
      headingPath: '',
      chunkIndex: 0,
      content: d.text,
      tokenCount: 1,
      embedding: emb,
      embedModel: 'fake',
      relatedDocs: [],
      contentHash: 'h',
    };
    await store.upsertDoc(d.id, [c]);
  }
}

describe('retrieve', () => {
  it('raw és full is ad találatot, a full rerankScore-t is', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(store, p);
    const raw = await retrieve(
      'holes in monstera leaves',
      { providers: p, store },
      { mode: 'raw', topN: 5, topK: 2 },
    );
    const full = await retrieve(
      'holes in monstera leaves',
      { providers: p, store },
      { mode: 'full', topN: 5, topK: 2 },
    );
    expect(raw.length).toBeGreaterThan(0);
    expect(full[0].rerankScore).toBeGreaterThanOrEqual(
      full[1]?.rerankScore ?? 0,
    );
    expect(full[0].docId).toBe('holes'); // a rerank a pontosan releváns doksit hozza elöl
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `retrieve.ts`**

```ts
import type { Providers } from './providers.js';
import type { Store } from './store.js';

export interface RetrievedChunk {
  docId: string;
  title: string;
  source: string;
  category: string;
  headingPath: string;
  content: string;
  distance: number;
  rerankScore?: number;
}

export async function retrieve(
  query: string,
  deps: { providers: Providers; store: Store },
  opts: { mode: 'raw' | 'full'; topN: number; topK: number },
): Promise<RetrievedChunk[]> {
  const { providers, store } = deps;
  const embedText = opts.mode === 'full' ? await providers.hyde(query) : query;
  const [embedding] = await providers.embed([embedText]);
  const hits = await store.similaritySearch(
    embedding,
    opts.mode === 'full' ? opts.topN : opts.topK,
  );
  if (opts.mode === 'raw') return hits.slice(0, opts.topK);

  const ranked = await providers.rerank(
    query,
    hits.map((h) => h.content),
    opts.topK,
  );
  return ranked.map((r) => ({ ...hits[r.index], rerankScore: r.score }));
}
```

- [ ] **Step 4: Run — PASS + commit**

```bash
nvm use 22 && npx nx test rag -- retrieve
git add packages/rag/src/lib/retrieve.ts packages/rag/src/lib/retrieve.spec.ts
git commit -m "feat(rag): retrieve raw vs full (HyDE→embed→similarity→Cohere rerank)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Answer — grounding (küszöb + forráshivatkozás)

**Files:**

- Create: `packages/rag/src/lib/answer.ts`, `answer.spec.ts`

**Interfaces:**

- Consumes: `retrieve` (Task 7), `Providers` (Task 4), `Store` (Task 5).
- Produces:
  - `const NO_ANSWER = 'Erről nincs információ a Plantbase tudásbázisban.'`
  - `interface GroundedAnswer { answer: string; grounded: boolean; sources: { title: string; source: string }[] }`
  - `answerFromKnowledge(query: string, deps: { providers; store }, opts: { topN; topK; minRerankScore: number }): Promise<GroundedAnswer>`
  - `buildGroundingPrompt(query: string, chunks: RetrievedChunk[]): string` (a forrás-fejléces kontextus)

- [ ] **Step 1: Failing test (`answer.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { answerFromKnowledge, NO_ANSWER } from './answer.js';
import { FakeProviders } from './providers.js';
import { InMemoryStore } from './store.js';
import type { StoredChunk } from './store.js';

async function seed(
  store: InMemoryStore,
  p: FakeProviders,
  id: string,
  text: string,
) {
  const [emb] = await p.embed([text]);
  const c: StoredChunk = {
    docId: id,
    title: id,
    source: `s/${id}`,
    category: 'c',
    headingPath: '',
    chunkIndex: 0,
    content: text,
    tokenCount: 1,
    embedding: emb,
    embedModel: 'fake',
    relatedDocs: [],
    contentHash: 'h',
  };
  await store.upsertDoc(id, [c]);
}

describe('answerFromKnowledge', () => {
  it('találat esetén grounded válasz + forrás', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(
      store,
      p,
      'snake',
      'snake plant water every two weeks bright indirect light',
    );
    const r = await answerFromKnowledge(
      'how often water snake plant',
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );
    expect(r.grounded).toBe(true);
    expect(r.sources[0].source).toBe('s/snake');
    expect(r.answer).not.toBe(NO_ANSWER);
  });
  it('küszöb alatt → nincs kitalálás', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    await seed(store, p, 'snake', 'snake plant care');
    const r = await answerFromKnowledge(
      'venus flytrap carnivorous plant care',
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.9 },
    );
    expect(r.grounded).toBe(false);
    expect(r.answer).toBe(NO_ANSWER);
    expect(r.sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `answer.ts`**

```ts
import { retrieve, type RetrievedChunk } from './retrieve.js';
import type { Providers } from './providers.js';
import type { Store } from './store.js';

export const NO_ANSWER = 'Erről nincs információ a Plantbase tudásbázisban.';

const ANSWER_SYSTEM =
  'Te a Plantbase növénygondozási asszisztense vagy. KIZÁRÓLAG a megadott kontextusból válaszolj, ' +
  'magyarul, tömören. Ha a kontextus nem fedi a kérdést, mondd ki, hogy nincs róla információ. ' +
  'A válasz végén sorold fel a felhasznált forrásokat (cím — URL). Soha ne találj ki forrást.';

export interface GroundedAnswer {
  answer: string;
  grounded: boolean;
  sources: { title: string; source: string }[];
}

export function buildGroundingPrompt(
  query: string,
  chunks: RetrievedChunk[],
): string {
  const ctx = chunks
    .map((c, i) => `[${i + 1}] Forrás: ${c.title} — ${c.source}\n${c.content}`)
    .join('\n\n---\n\n');
  return `Kérdés: ${query}\n\nKontextus:\n${ctx}`;
}

export async function answerFromKnowledge(
  query: string,
  deps: { providers: Providers; store: Store },
  opts: { topN: number; topK: number; minRerankScore: number },
): Promise<GroundedAnswer> {
  const chunks = await retrieve(query, deps, {
    mode: 'full',
    topN: opts.topN,
    topK: opts.topK,
  });
  const best = chunks[0]?.rerankScore ?? 0;
  if (chunks.length === 0 || best < opts.minRerankScore)
    return { answer: NO_ANSWER, grounded: false, sources: [] };
  const answer = await deps.providers.answer(
    ANSWER_SYSTEM,
    buildGroundingPrompt(query, chunks),
  );
  const seen = new Set<string>();
  const sources = chunks
    .filter((c) => !seen.has(c.source) && seen.add(c.source))
    .map((c) => ({ title: c.title, source: c.source }));
  return { answer, grounded: true, sources };
}
```

- [ ] **Step 4: Run — PASS + commit**

```bash
nvm use 22 && npx nx test rag -- answer
git add packages/rag/src/lib/answer.ts packages/rag/src/lib/answer.spec.ts
git commit -m "feat(rag): grounding (rerank-küszöb + forráshivatkozás, nincs-találat üzenet)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: `index.ts` export**

`packages/rag/src/index.ts` re-exportálja: `config`, `chunker`, `providers`, `store`, `ingest`, `retrieve`, `answer`, `golden`. Commit: `feat(rag): publikus API export`.

---

## Task 9: Agent-integráció — `searchKnowledge` tool + system prompt

**Files:**

- Create: `packages/core/src/lib/tools/search-knowledge.ts`, `search-knowledge.spec.ts`
- Modify: `packages/core/src/lib/tools/agent-tools.ts` (regisztráció)
- Modify: `packages/core/src/lib/system-prompt.ts`
- Modify: `packages/core/package.json` (`@plantbase/rag` dep)

**Interfaces:**

- Consumes: `answerFromKnowledge`, `loadRagConfig`, `createProviders`, `PgStore` a `@plantbase/rag`-ból; a RO `Pool` a `run-sql.ts` mintájára.
- Produces: `searchKnowledge` tool a `ToolSet`-ben (AI SDK `tool()`), input `{ query: string }`, output: grounded válasz-objektum a modellnek (forrásokkal), vagy a „nincs a tudásbázisban" jelzés.

- [ ] **Step 1: Failing test (`search-knowledge.spec.ts`) — a tool a RAG-függvényt hívja, DI-vel**

```ts
import { describe, it, expect } from 'vitest';
import { buildSearchKnowledge } from './search-knowledge.js';

describe('buildSearchKnowledge', () => {
  it('a grounded választ + forrásokat adja vissza a modellnek', async () => {
    const fakeAnswer = async () => ({
      answer: 'Kéthetente öntözd.',
      grounded: true,
      sources: [{ title: 'Snake', source: 's/snake' }],
    });
    const tool = buildSearchKnowledge(fakeAnswer as any);
    const out = await tool.execute!({ query: 'öntözés?' }, {} as any);
    expect(out).toMatchObject({ grounded: true });
    expect(JSON.stringify(out)).toContain('s/snake');
  });
  it('nincs találatkor grounded:false', async () => {
    const fakeAnswer = async () => ({
      answer: 'Erről nincs információ a Plantbase tudásbázisban.',
      grounded: false,
      sources: [],
    });
    const tool = buildSearchKnowledge(fakeAnswer as any);
    const out = await tool.execute!({ query: 'x' }, {} as any);
    expect(out).toMatchObject({ grounded: false });
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `search-knowledge.ts`**

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { GroundedAnswer } from '@plantbase/rag';

export type AnswerFn = (query: string) => Promise<GroundedAnswer>;

// A tool a DI-vel kapott answer-függvényt hívja (teszt: fake; éles: a config.ts-ből felépített pipeline).
export function buildSearchKnowledge(answer: AnswerFn) {
  return tool({
    description:
      'Növénygondozási TUDÁS-kérdésekre (hogyan gondozzam / miért / tünetek) keres a Plantbase ' +
      'tudásbázisban (cikkek). Nem katalógus-kérdésekre. Forráshivatkozásos, grounded választ ad; ' +
      'ha nincs találat, azt jelzi (grounded=false) — ilyenkor mondd ki, hogy nincs róla információ.',
    inputSchema: z.object({
      query: z.string().describe('A tudás-kérdés természetes nyelven.'),
    }),
    execute: async ({ query }) => answer(query),
  });
}
```

- [ ] **Step 4: Éles bekötés `agent-tools.ts`-ben (lazy, RO pool)**

Az `agent-tools.ts` `buildTools(collector)`-jába vedd fel a `searchKnowledge`-t. Éles `AnswerFn` (a fájl tetején, lazy singletonokkal a `run-sql.ts` Pool-mintájára):

```ts
import { Pool } from 'pg';
import {
  loadRagConfig,
  createProviders,
  PgStore,
  answerFromKnowledge,
} from '@plantbase/rag';

let ragPool: Pool | undefined;
function liveAnswer(query: string) {
  const cfg = loadRagConfig();
  ragPool ??= new Pool({ connectionString: process.env.DATABASE_URL_READONLY });
  const deps = { providers: createProviders(cfg), store: new PgStore(ragPool) };
  return answerFromKnowledge(query, deps, {
    topN: cfg.topN,
    topK: cfg.topK,
    minRerankScore: cfg.minRerankScore,
  });
}
// a ToolSet-be: searchKnowledge: buildSearchKnowledge(liveAnswer)
```

`packages/core/package.json` deps közé: `"@plantbase/rag": "workspace:*"`, majd `nvm use 22 && pnpm install`.

- [ ] **Step 5: System prompt kiegészítés**

`system-prompt.ts` `<tools>` és `<behavior>` blokkjába:

```
- searchKnowledge(query): növénygondozási TUDÁS-kérdésre (hogyan/miért/tünetek) keres a tudásbázis-cikkekben.
  Katalógus-kérdésnél (ár, készlet, méret) továbbra is runSql. Tudás-kérdésnél MINDIG ezt hívd.
- Tudás-válaszban MINDIG hivatkozz a forrásokra (cím + URL), amit a tool visszaad.
- Ha a searchKnowledge grounded=false-t ad (nincs találat), MONDD KI, hogy erről nincs információ a
  tudásbázisban — SOHA ne találj ki forrást vagy tényt.
```

- [ ] **Step 6: Run tesztek + commit**

```bash
nvm use 22 && npx nx test core && npx nx test rag
git add packages/core packages/rag pnpm-lock.yaml
git commit -m "feat(core): searchKnowledge agent-tool + grounding system-prompt szabályok

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Golden-set runner + CLI parancsok (`rag:index`, `rag:golden`)

**Files:**

- Create: `packages/rag/src/lib/golden.ts`, `golden.spec.ts`
- Modify: `apps/cli/src/main.ts` (`rag:index`, `rag:golden` parancsok)
- Create: `docs/RAG/GOLDEN-SET.md` (sablon, a runner tölti ki)

**Interfaces:**

- Consumes: `retrieve` (Task 7), `answerFromKnowledge` (Task 8), `ingestDocs` (Task 6).
- Produces:
  - `const GOLDEN_QUESTIONS: { id: number; q: string; note: string }[]` (8 kérdés a spec 9. táblájából)
  - `runGolden(deps: { providers; store }, cfg): Promise<GoldenReport>` — kérdésenként raw vs full lista + grounded flag.
  - `renderGoldenMarkdown(report: GoldenReport): string`

- [ ] **Step 1: Failing test (`golden.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { GOLDEN_QUESTIONS, runGolden, renderGoldenMarkdown } from './golden.js';
import { FakeProviders } from './providers.js';
import { InMemoryStore } from './store.js';
import type { StoredChunk } from './store.js';

describe('golden', () => {
  it('legalább 8 kérdés, van megválaszolhatatlan (Vénusz légycsapó)', () => {
    expect(GOLDEN_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(GOLDEN_QUESTIONS.some((q) => /légycsapó|flytrap/i.test(q.q))).toBe(
      true,
    );
  });
  it('runGolden minden kérdésre ad raw+full sort, és markdownt renderel', async () => {
    const store = new InMemoryStore();
    const p = new FakeProviders();
    const [emb] = await p.embed(['snake plant water light']);
    const c: StoredChunk = {
      docId: 'snake',
      title: 'Snake',
      source: 's/snake',
      category: 'c',
      headingPath: '',
      chunkIndex: 0,
      content: 'snake plant water light',
      tokenCount: 1,
      embedding: emb,
      embedModel: 'fake',
      relatedDocs: [],
      contentHash: 'h',
    };
    await store.upsertDoc('snake', [c]);
    const rep = await runGolden(
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );
    expect(rep.rows.length).toBe(GOLDEN_QUESTIONS.length);
    expect(renderGoldenMarkdown(rep)).toMatch(/raw|full/i);
  });
});
```

- [ ] **Step 2: Run — FAIL**, majd **Step 3: Implement `golden.ts`**

```ts
import { retrieve, type RetrievedChunk } from './retrieve.js';
import { answerFromKnowledge } from './answer.js';
import type { Providers } from './providers.js';
import type { Store } from './store.js';

export const GOLDEN_QUESTIONS = [
  {
    id: 1,
    q: 'Milyen fényt igényel a Monstera deliciosa?',
    note: 'answerable',
  },
  {
    id: 2,
    q: 'Milyen gyakran öntözzem a kígyónövényt (snake plant)?',
    note: 'answerable',
  },
  { id: 3, q: 'Hogyan szaporítsak pothost dugványról?', note: 'answerable' },
  { id: 4, q: 'Miért sárgulnak a növényem levelei?', note: 'answerable' },
  {
    id: 5,
    q: 'Hogyan szabaduljak meg a gombaszúnyogoktól?',
    note: 'answerable',
  },
  {
    id: 6,
    q: 'Miért lyukasak a Monstera / swiss cheese növény levelei?',
    note: 'rerank-átrendezés jelölt',
  },
  {
    id: 7,
    q: 'Melyik szobanövény biztonságos macskák mellé?',
    note: 'answerable',
  },
  {
    id: 8,
    q: 'Hogyan gondozzam a húsevő Vénusz légycsapót?',
    note: 'MEGVÁLASZOLHATATLAN — grounding próba',
  },
] as const;

export interface GoldenRow {
  id: number;
  q: string;
  note: string;
  raw: RetrievedChunk[];
  full: RetrievedChunk[];
  grounded: boolean;
  answer: string;
}
export interface GoldenReport {
  rows: GoldenRow[];
  cfg: { topN: number; topK: number; minRerankScore: number };
}

export async function runGolden(
  deps: { providers: Providers; store: Store },
  cfg: { topN: number; topK: number; minRerankScore: number },
): Promise<GoldenReport> {
  const rows: GoldenRow[] = [];
  for (const { id, q, note } of GOLDEN_QUESTIONS) {
    const raw = await retrieve(q, deps, {
      mode: 'raw',
      topN: cfg.topN,
      topK: cfg.topK,
    });
    const full = await retrieve(q, deps, {
      mode: 'full',
      topN: cfg.topN,
      topK: cfg.topK,
    });
    const grounded = await answerFromKnowledge(q, deps, cfg);
    rows.push({
      id,
      q,
      note,
      raw,
      full,
      grounded: grounded.grounded,
      answer: grounded.answer,
    });
  }
  return { rows, cfg };
}

const rankList = (cs: RetrievedChunk[]) =>
  cs
    .map(
      (c, i) =>
        `${i + 1}. ${c.docId}${c.rerankScore !== undefined ? ` (rr=${c.rerankScore.toFixed(3)})` : ` (d=${c.distance.toFixed(3)})`}`,
    )
    .join('<br>');

export function renderGoldenMarkdown(report: GoldenReport): string {
  const head =
    `# Golden Set — raw vs full pipeline\n\n` +
    `Konfiguráció: topN=${report.cfg.topN}, topK=${report.cfg.topK}, minRerankScore=${report.cfg.minRerankScore}\n\n` +
    `| # | Kérdés | Raw (embedding) | Full (HyDE+rerank) | Grounded |\n|---|---|---|---|---|\n`;
  const body = report.rows
    .map(
      (r) =>
        `| ${r.id} | ${r.q} | ${rankList(r.raw)} | ${rankList(r.full)} | ${r.grounded ? 'igen' : 'NINCS'} |`,
    )
    .join('\n');
  const notes =
    `\n\n## Megjegyzések\n` +
    report.rows
      .map(
        (r) =>
          `- **#${r.id}** (${r.note}): ${r.answer.replace(/\n/g, ' ').slice(0, 200)}`,
      )
      .join('\n');
  return head + body + notes;
}
```

- [ ] **Step 4: CLI parancsok `apps/cli/src/main.ts`-ben**

Adj két parancsot (a meglévő CLI-argument minta szerint):

- `rag:index` → beolvassa `docs/knowledge/*.md`-t (`fs.readdirSync`), `docId = fájlnév .md nélkül`, felépíti az éles `createProviders(loadRagConfig())` + `PgStore(new Pool({connectionString: DATABASE_URL}))` (RW!) deps-et, `ingestDocs(...)`, kiírja az `IngestResult`-ot.
- `rag:golden` → RO Pool + éles providerek, `runGolden(...)`, majd `fs.writeFileSync('docs/RAG/GOLDEN-SET.md', renderGoldenMarkdown(report))`.

- [ ] **Step 5: Run tesztek + commit**

```bash
nvm use 22 && npx nx test rag -- golden
git add packages/rag/src/lib/golden.ts packages/rag/src/lib/golden.spec.ts apps/cli/src/main.ts docs/RAG/GOLDEN-SET.md
git commit -m "feat(rag): golden-set runner (raw vs full) + rag:index/rag:golden CLI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: `docs/RAG/ARCHITEKTURA.md` (inkrementális frissítés — csak terv)

**Files:**

- Create: `docs/RAG/ARCHITEKTURA.md`

- [ ] **Step 1: Dokumentum megírása** — a spec 11. szakasza alapján, kifejtve:
  - Változás-detektálás `content_hash`-sel (egyezés → skip, nincs újra-embed).
  - Új dokumentum → chunk+embed+insert.
  - Törölt dokumentum → filesystem↔tábla `doc_id` reconcile, hiányzó doc chunkjainak törlése.
  - Módosult dokumentum → régi chunkok törlése + újrachunk/embed/insert.
  - Reindex-trigger: manuális `rag:index`, git-hook/CI a `docs/knowledge/**` változására, cron/watch.
  - `embed_model` verziózás → modellváltáskor teljes re-embed.
  - Utalás az implementált magokra: `hashBody`, `ingestDocs` skip/delete-logika, `PgStore.docHashes/deleteByDocId`.

- [ ] **Step 2: Commit**

```bash
git add docs/RAG/ARCHITEKTURA.md
git commit -m "docs(rag): inkrementális újraindexelés architektúra-terv

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Élő futtatás (felhasználó) + záró verifikáció

**Nem kód** — a felhasználó a saját kulcsaival futtatja; a plan itt a lépéseket rögzíti.

- [ ] **Step 1: Kulcsok** — `.env`-be `OPENAI_API_KEY`, `COHERE_API_KEY` (az `ANTHROPIC_API_KEY` már megvan).
- [ ] **Step 2: DB fel + migráció** — `docker compose up -d db && nvm use 22 && npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`.
- [ ] **Step 3: Indexelés** — `nvm use 22 && pnpm cli rag:index` → `IngestResult { indexed: ~202 }`.
- [ ] **Step 4: Golden-set** — `pnpm cli rag:golden` → `docs/RAG/GOLDEN-SET.md`. Ellenőrizd: a #8 (Vénusz légycsapó) `grounded=NINCS`; legalább egy kérdésnél a full sorrend eltér a raw-tól (rerank átrendezés) — a report Megjegyzésekben indokold, miért jobb. Ha egyik sem rendez át, dokumentáld, miért.
- [ ] **Step 5: Agent-próba** — `pnpm cli` chat: „Miért sárgulnak a leveleim?" → forráshivatkozásos válasz; „Hogyan gondozzam a Vénusz légycsapót?" → „nincs a tudásbázisban".
- [ ] **Step 6: PR** — `gh pr create --base main --head feat/rag-knowledge-base` a RAG-feature-höz.

---

## Self-Review (terv ↔ spec lefedettség)

- **Embedding + pgvector** → Task 1 (tábla) + Task 4 (OpenAI embed) + Task 5 (PgStore). ✓
- **HyDE** → Task 4 (`hydeFromAnthropic`) + Task 7 (`mode:'full'`). ✓
- **Rerank** → Task 4 (`rerankFromCohere`) + Task 7. ✓
- **Grounding (forrás + nincs-találat)** → Task 8 (`answerFromKnowledge`, `NO_ANSWER`) + Task 9 (system prompt). ✓
- **Multi-provider szereposztás** → Task 4 (OpenAI/Cohere/Anthropic) + spec 4. tábla. ✓
- **Chunking + cross-ref + tesztek** → Task 3 (`chunkDoc`, `extractRelated/resolveRelated`, boilerplate-strip, 7 teszt). ✓
- **Golden set (8 Q, unanswerable, rerank-demó, raw vs full)** → Task 10 + Task 12/Step 4. ✓
- **ARCHITEKTURA.md** → Task 11. ✓
- **Phase 0 (PR #13 → main, RAG-ág)** → Task 0. ✓
- **Kulcs nélküli tesztelhetőség (DI)** → Task 4 `FakeProviders` + Task 5 `InMemoryStore`; minden `*.spec.ts` ezekkel fut. ✓
- **content_hash (részleges inkrementális)** → Task 5 séma + Task 6 `ingestDocs`. ✓

Type-konzisztencia ellenőrizve: `Providers`/`Store`/`RetrievedChunk`/`GroundedAnswer`/`StoredChunk` szignatúrák végig egyeznek a Task 4–10 között.
