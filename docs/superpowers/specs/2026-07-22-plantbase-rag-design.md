# Plantbase RAG — tervezet (spec)

- **Dátum:** 2026-07-22
- **Státusz:** jóváhagyásra vár
- **Cél:** a `docs/knowledge/` növény-tudásbázisból RAG-gal új, forráshivatkozásos tudással felruházni a Plantbase agentet, HyDE + rerank + grounding pipeline-nal, pgvector tárolással és multi-provider routinggal.

---

## 1. Kontextus és cél

A repo egy nx + pnpm monorepo (`@plantbase/*`). A meglévő agent (AI SDK, több­lépéses tool-loop) a `products` katalógus felett válaszol `runSql` / `listCategories` toolokkal. A `docs/knowledge/` alatt **202 markdown cikk** van (The Sill blog), egységes frontmatterrel (`title`, `source` URL, `category`), 5 kategóriában.

A katalógus („melyik terméket") és a tudásbázis („hogyan gondozzam") **komplementer**: az agent kap egy `searchKnowledge` toolt, és a system prompt eldönti, mikor katalógus-SQL, mikor tudásbázis-RAG a helyes.

### Kötelező elemek (a feladatból)

1. Embedding + vektor-tárolás — **pgvector**.
2. **HyDE** (Hypothetical Document Embeddings).
3. **Rerank**.
4. **Grounding** — forráshivatkozás (cím / URL / fájlnév); ha nincs találat, az agent kimondja.
5. **Multi-provider routing** — ≥2 provider, dokumentált szereposztással.
6. **Golden set** — 5–10 kérdés, nyers vektorkeresés vs teljes pipeline összevetése; ≥1 rerank-átrendezés bemutatva; ≥1 megválaszolhatatlan kérdés a grounding próbájára.
7. **`docs/RAG/ARCHITEKTURA.md`** — inkrementális frissítés terve (nem implementált).

### Scope / non-goals

- **In scope:** `@plantbase/rag` csomag (ingestion + retrieval + grounding), `searchKnowledge` agent-tool, golden-set runner CLI, unit-tesztek (kulcs nélkül futnak), `docs/RAG/ARCHITEKTURA.md`.
- **Non-goal:** az inkrementális újraindexelés implementációja (csak dokumentálva; a `content_hash` oszlop és az idempotens upsert viszont beépül, mert olcsó és félig demonstrálja). Nem cél a `docs/knowledge` tartalmi szerkesztése, se új UI.

---

## 2. Phase 0 — előfeltétel: PR #13 → main, majd RAG-ág

A RAG a main tool-regiszterébe köt be, de az egységes alap az **AI SDK** (a felhasználó döntése). Az `origin/main` időközben előreugrott (PR #12: `errors.ts`, `tools/` mappa, `tools/registry.ts`, `.claude/` tooling), ezért a PR #13 (AI SDK-migráció) **konfliktusos**. Feloldási stratégia (AI SDK a győztes), teszt-verifikációval, és **csak zöld tesztek után** GitHub-oldali merge:

| Elem                                                                     | Feloldás                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `ask-agent.ts`, `main.ts`, `provider.ts`, `agent-tools.ts`, AI SDK depek | branch (#13) nyer — AI SDK-alap                                                 |
| `errors.ts` (+spec)                                                      | main-ből megtartva; `agent-tools.ts` `toolError`-ja erre delegál                |
| `tools/` mappa-elrendezés                                                | átvéve: `run-sql.ts`, `list-categories.ts`, `agent-tools.ts` a `tools/` alá     |
| `tools/registry.ts` (Anthropic.Tool-alapú)                               | elvetve — szerepét az AI SDK `agent-tools.ts` (`buildTools`→`ToolSet`) tölti be |
| `.claude/` tooling                                                       | main-ből megtartva                                                              |
| `new-agent-tool/SKILL.md`                                                | reconcile: AI SDK `tool()` minta a `tools/` útvonalra                           |

Ezután: `feat/rag-knowledge-base` ág az egységes `main`-ről. A spec ezen az ágon lesz commitolva (első commit).

---

## 3. Architektúra — `@plantbase/rag` (`packages/rag`)

Új csomag három, jól elhatárolt réteggel. Minden provider-hívás egy **injektálható interfészen** megy át, hogy a unit-tesztek kulcs nélkül, determinisztikus fake-ekkel fussanak.

```
packages/rag/src/
  index.ts
  lib/
    markdown.ts        # frontmatter+törzs parse (parseDoc)
    chunker.ts         # boilerplate-strip, cross-ref kinyerés, chunkolás  (TESZTELT EGYSÉG)
    chunker.spec.ts
    providers.ts       # Providers interfész: embed / hyde / rerank / answer  (injektálható)
    providers.spec.ts
    openai-embeddings.ts   # OpenAI text-embedding-3-small (AI SDK embedMany)
    jina-rerank.ts         # Jina jina-reranker-v2-base-multilingual (fetch)
    anthropic-gen.ts       # Anthropic HyDE (haiku) + grounded válasz (sonnet)
    store.ts           # pgvector CRUD: upsertChunks / similaritySearch (pg)
    store.spec.ts
    ingest.ts          # pipeline: fájlok -> chunk -> embed -> upsert (+content-hash)
    retrieve.ts        # raw és full retrieval (HyDE -> embed -> pgvector -> rerank)
    retrieve.spec.ts
    answer.ts          # grounding: küszöb + forráshivatkozásos válasz / "nincs a tudásbázisban"
    answer.spec.ts
    config.ts          # env-kulcsok, küszöbök, modell-id-k (fail-fast, magyar hibák)
```

Az agent-integráció a `@plantbase/core`-ban él (a `searchKnowledge` tool a `tools/` alatt), a RAG-csomag függvényeit hívva.

### Rétegek

- **Ingestion (index-idő, RW):** `ingest.ts` — fájlok beolvasása, `parseDoc` → `stripBoilerplate` → `extractRelated`/`resolveRelated` → `chunkDoc` → `embed` (batch) → `upsertChunks`. Per-doc `content_hash` az idempotens újrafuttatáshoz.
- **Retrieval (query-idő, RO):** `retrieve.ts` — `raw` mód (query-embed → `similaritySearch` top-K) és `full` mód (HyDE → embed → `similaritySearch` top-N → Jina rerank → top-K).
- **Grounding:** `answer.ts` — a top-K chunkból forráshivatkozásos prompt → Anthropic szintézis; ha a legjobb (rerank/hasonlósági) score a küszöb alatt → „Erről nincs információ a tudásbázisban." (nincs forráskitalálás).

---

## 4. Multi-provider szereposztás

| Lépés                         | Provider / modell                                             | Miért pont az                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Embedding** (index + query) | **OpenAI** `text-embedding-3-small` (1536-dim)                | Erős, olcsó, batch-elhető retrieval-embedding; a keresés minőségének alapja. Nem generatív → dedikált embedding-modell. Többnyelvű: a magyar kérdést is jól illeszti az angol korpuszhoz.                                                                                                                                                                                         |
| **HyDE** (hipotetikus válasz) | **Anthropic** `claude-haiku-4-5`                              | Rövid, olcsó, gyors generálás; a HyDE-hoz elég egy hihető, „válasz-alakú" szöveg, amit embedelünk. A prompt **angolul** generáltat (a korpusz nyelve) → maximális embedding-átfedés, egyben nyelvi hídként is szolgál.                                                                                                                                                            |
| **Rerank**                    | **Jina** `jina-reranker-v2-base-multilingual` (cross-encoder) | Célépített, többnyelvű query–dokumentum relevancia-pontozó. A rerank „tankönyvi" eszköze; a golden-set átrendezés-demóhoz stabil, magyarázható score-t ad — nem LLM-heurisztika. (Eredetileg Cohere `rerank-v3.5` volt; Jina-ra cserélve, mert a Cohere enterprise-only, a Jina viszont ingyenes, azonnali self-serve kulccsal jár — a `Providers.rerank` interfész változatlan.) |
| **Végső grounded válasz**     | **Anthropic** `claude-sonnet-4-6`                             | Erős szintézis, magyar nyelvű, forráshivatkozásos, szabálykövető (grounding) válasz.                                                                                                                                                                                                                                                                                              |

3 provider, mindegyik a saját erősségén (embedding-modell / cross-encoder reranker / generatív modell). Anthropic két szerepben, két modell-szinttel (olcsó HyDE / erős válasz) — költség-optimalizált.

**Új env-kulcsok:** `OPENAI_API_KEY`, `JINA_API_KEY` (az `ANTHROPIC_API_KEY` már megvan). **Új dep:** `@ai-sdk/openai`. A Jina rerankot vékony `fetch`-kliens hívja (nincs nagy SDK-dep).

---

## 5. Adatmodell — pgvector

- Docker image: `postgres:17` → **`pgvector/pgvector:pg17`** (a `vector` extension elérhetőségéhez).
- Prisma-migráció: `CREATE EXTENSION IF NOT EXISTS vector;` + tábla + HNSW index. A meglévő `ALTER DEFAULT PRIVILEGES` miatt a RO role automatikusan kap SELECT-et → az agent RO kapcsolaton olvas (mint a `runSql`), az ingestion RW-n (owner) ír.

```sql
CREATE TABLE knowledge_chunks (
  id            BIGSERIAL PRIMARY KEY,
  doc_id        TEXT NOT NULL,          -- stabil id = fájlnév .md nélkül
  doc_title     TEXT NOT NULL,          -- grounding: cím
  doc_source    TEXT NOT NULL,          -- grounding: URL
  doc_category  TEXT NOT NULL,
  heading_path  TEXT NOT NULL,          -- "Monstera Care > What light conditions…"
  chunk_index   INT  NOT NULL,
  content       TEXT NOT NULL,          -- kontextualizált chunk (cím+heading prefix + szöveg)
  content_hash  TEXT NOT NULL,          -- per-doc hash → inkrementális/idempotens
  related_docs  TEXT[] NOT NULL DEFAULT '{}',  -- feloldott "Learn More" cross-ref doc_id-k
  token_count   INT  NOT NULL,
  embedding     VECTOR(1536) NOT NULL,
  embed_model   TEXT NOT NULL,          -- modell-verzió → full re-embed modellváltáskor
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, chunk_index)
);
CREATE INDEX knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX knowledge_chunks_doc_id_idx ON knowledge_chunks (doc_id);
```

A similarity-keresés koszinusz-távolság (`<=>`), `ORDER BY embedding <=> $1 LIMIT $2`.

---

## 6. Chunkolás + cross-reference (a tesztelt egység)

Tiszta függvények `chunker.ts`-ben (`markdown.ts` a parse-hoz), `chunker.spec.ts` tesztekkel. **Ez a feladat kiemelt, unit-tesztelt része.**

### Függvények

- **`parseDoc(raw) → { frontmatter, body }`** — YAML frontmatter (title/source/category) + törzs.
- **`stripBoilerplate(body) → string`** — kivágja a `## Perfect Pairings…`-tól a fájl végéig, a `##### Words By The Sill` footert és a `Shop …!` upsell-sorokat (mind a 202 doksin jelen). A `### Learn More` blokkot **a kinyerés után** eltávolítja (navigáció, nem tudás).
- **`extractRelated(body) → string[]`** — a `### Learn More` listaelemeket (cikkcímeket) kinyeri.
- **`resolveRelated(titles, corpusIndex) → docId[]`** — a címeket fuzzy-matcheli a korpusz frontmatter-címeire → `related_docs`. (Csak 5 doksinak van ilyen szekciója → bounded, tesztelt.)
- **`chunkDoc(doc, opts) → Chunk[]`** — markdown-heading határ mentén (`##`/`###`/`####`) szekcionál, majd ~**350–500 tokenes** chunkokba pakol; nagy szekciót **bekezdés-határon** vág, ~1 bekezdés **overlappal**; sosem vág mondat közben. **Minden chunk elé kontextus-prefix kerül: `"{title} — {heading_path}\n\n{szöveg}"`.**

### Miért így — a cross-reference kezelése

A cikkek közti utalások két formában élnek: (a) explicit `### Learn More` listák (csak 5 doksi) → `related_docs` metaadat; (b) prózai utalások („learn more … here"), amelyekből az export **kivágta az URL-t** → gépileg nem feloldható, csak szemantikus. Ezért a chunkolás fő elve a **kontextus-megőrzés**: a cím+heading-path prefix miatt minden chunk **önmagában grounded** marad, így az „as mentioned above" / stripped-link típusú utalás sem lóg a levegőben — a retrieval és az LLM is tudja, melyik dokumentum melyik szekciójából való. A `related_docs` opcionálisan bővíthetővé teszi a találatot testvér-doksikra és a grounding a cikk-családot is hivatkozhatja. Nehéz cross-ref gráf helyett **bounded, tesztelt** metaadat — YAGNI.

### Unit-tesztek (`chunker.spec.ts`)

1. `stripBoilerplate` eltávolítja a Perfect Pairings + Words By The Sill + Shop-sorokat, megtartja a tartalmat.
2. `extractRelated` kinyeri a Learn More címeket; üres, ha nincs ilyen szekció.
3. `resolveRelated` a címeket létező doc_id-kra oldja (fuzzy), ismeretlent kihagy.
4. `chunkDoc` heading-határon vág; a chunk-token min/max betartva; overlap jelen.
5. Minden chunk kontextus-prefixszel kezdődik (title + heading_path).
6. `parseDoc` a title/source/category-t helyesen adja vissza.
7. Edge: üres törzs, frontmatter-only, heading nélküli doksi, egyetlen óriás-bekezdés.

---

## 7. Retrieval pipeline

`retrieve.ts` egyetlen `retrieve(query, { mode, topN, topK })` függvény, két módban:

- **`raw`** (baseline): `embed(query)` → `similaritySearch(vec, topK)`. Csak embedding + koszinusz-távolság.
- **`full`**: `hyde(query)` → hipotetikus (angol) passzus → `embed(hyde)` → `similaritySearch(vec, topN=~20)` → **Jina `jina-reranker-v2-base-multilingual`** a `query` ellen → top-K (~5). A rerank a HyDE-torzítást is korrigálja (a hipotetikus szöveg hozza a recall-t, a rerank adja a precíziót az _eredeti_ kérdésre).

Mindkét mód strukturált találatot ad: `{ docId, title, source, category, headingPath, content, score, rerankScore? }[]` — a golden-set összevetéshez és a groundinghoz.

---

## 8. Grounding és válasz

`answer.ts`:

- **Küszöb:** ha `full` retrieval legjobb `rerankScore`-ja < `RAG_MIN_RERANK_SCORE` (konfig, pl. 0.30) → nincs érdemi találat → **„Erről nincs információ a Plantbase tudásbázisban."** (nincs LLM-hívás forrásra, nincs kitalálás). Ez a grounding-próba magja.
- **Van találat:** a top-K chunk (content + `[cím · forrás-URL]` fejléc) egy grounded promptba kerül; Anthropic `claude-sonnet-4-6` magyar választ ad, **a végén forráshivatkozásokkal** (cím + URL/fájlnév). A system-szabály: „csak a megadott kontextusból válaszolj; ha a kontextus nem fedi, mondd ki".
- **Agent-integráció:** a `searchKnowledge` tool a `retrieve(query, {mode:'full'})`-t hívja, és a top-K chunkot **forrásokkal együtt** adja vissza a modellnek; a rendszer-prompt kiegészül: „tudás-kérdésnél hívd a `searchKnowledge`-t, mindig hivatkozz forrásra, és ha a tool üres/nincs találat, mondd ki, hogy nincs a tudásbázisban — soha ne találj ki forrást." A küszöb-döntés a toolban (nem az LLM-re bízva) történik, hogy a grounding determinisztikus legyen.

---

## 9. Golden set (bizonyíték)

`apps/cli` új parancs: `rag:golden`. 8 kérdést futtat **raw** és **full** módban, és `docs/RAG/GOLDEN-SET.md`-be írja az összevető táblát (rang, doc, score, rerankScore) + a nyers debug-kimenetet. A kérdéskészlet (magyar, a korpusz angol → a HyDE hidalja a nyelvet):

| #   | Kérdés                                                | Várt viselkedés                                                                            |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Milyen fényt igényel a Monstera deliciosa?            | answerable (monstera care)                                                                 |
| 2   | Milyen gyakran öntözzem a kígyónövényt (snake plant)? | answerable                                                                                 |
| 3   | Hogyan szaporítsak pothost dugványról?                | answerable                                                                                 |
| 4   | Miért sárgulnak a növényem levelei?                   | answerable (why-leaves-yellow)                                                             |
| 5   | Hogyan szabaduljak meg a gombaszúnyogoktól?           | answerable (bug-off-fungus-gnats)                                                          |
| 6   | Miért lyukasak a Monstera/„swiss cheese" levelei?     | **rerank-átrendezés jelölt** (why-swiss-cheese-plant-has-holes vs generikus monstera-care) |
| 7   | Melyik szobanövény biztonságos macskák mellé?         | answerable (pet-friendly)                                                                  |
| 8   | Hogyan gondozzam a húsevő Vénusz légycsapót?          | **MEGVÁLASZOLHATATLAN** (0 találat a korpuszban) → „nincs a tudásbázisban"                 |

- **Rerank-demó:** legalább a #6-nál (vagy amelyiknél empirikusan átrendez) a report megmutatja a **raw vs full sorrendet** és szövegesen indokolja, miért jobb az új. Ha egyetlen kérdésnél sem rendez át → azt is dokumentáljuk és megmagyarázzuk (miért volt már a nyers sorrend is helyes).
- **Grounding-próba:** a #8-nál a full pipeline a küszöb alatt marad → az agent kimondja, hogy nincs információ, forráskitalálás helyett. (Igazolt: „venus flytrap"/„húsevő" → 0 fájl.)
- **Determinizmus:** a golden-set runner rögzíti a modell-id-ket és a küszöböt a reportban; a rerankScore-ok stabilak (cross-encoder).

A runner **injektálható providerekkel** épül: kulcsokkal élő futás; kulcs nélkül a fake providerrel demo-mód (a report sablon generálódik). Élő futást **a felhasználó** végez a saját kulcsaival — a parancs + a `GOLDEN-SET.md` szerkezet készen áll.

---

## 10. Testability — provider injektálás

A `Providers` interfész (`embed`, `hyde`, `rerank`, `answer`) egyetlen csere-pont. Éles implementáció: OpenAI/Jina/Anthropic. Teszt-implementáció: determinisztikus fake (pl. hash-alapú pszeudó-embedding, azonosság-alapú fake rerank), így **minden unit-teszt kulcs és hálózat nélkül fut** (a repo `*.spec.ts` mintája szerint, vitest). Az `ingest`/`retrieve`/`answer` a `Providers`-t paraméterként kapja (DI), az éleset a `config.ts` állítja össze env-ből, fail-fast magyar hibákkal.

---

## 11. `docs/RAG/ARCHITEKTURA.md` (nem implementált, csak terv)

Külön dokumentum az inkrementális frissítésről (a feladat kötelező eleme):

- **Változás-detektálás:** per-doc `content_hash` (a normalizált törzs hash-e) a `knowledge_chunks`-ban. Reindexkor a fájl hash-ét összevetjük a tároltat; **egyezés → skip** (nem embedelünk újra). Így a változatlan doksi nem generál API-hívást.
- **Új dokumentum:** nincs `doc_id` a táblában → chunk + embed + insert.
- **Törölt dokumentum:** a filesystem `doc_id`-halmazát reconcile-oljuk a tábláéval; a filesystemből hiányzó `doc_id` **összes chunkját töröljük** (`DELETE … WHERE doc_id = …`).
- **Módosult dokumentum:** hash eltér → a doc régi chunkjait töröljük, újrachunkoljuk+embedeljük+beszúrjuk (chunk-szintű diff helyett egyszerű, korrekt doc-szintű csere).
- **Reindex-trigger:** manuális CLI (`rag:index`), git-hook / CI a `docs/knowledge/**` változására, vagy időzített (cron/watch). A trigger a teljes reconcile-t futtatja (hash-alapú skippel olcsó).
- **Modell-verziózás:** `embed_model` oszlop; embedding-modell váltásakor a nem egyező `embed_model`-ű sorok **teljes re-embedet** kapnak.

---

## 12. Új függőségek és env

- **Dep:** `@ai-sdk/openai` (embedding), `pgvector/pgvector:pg17` docker image. Jina rerank: `fetch` (nincs SDK-dep).
- **Env (`.env.example` bővül):** `OPENAI_API_KEY`, `JINA_API_KEY`, opcionálisan `OPENAI_EMBED_MODEL`, `JINA_RERANK_MODEL`, `ANTHROPIC_HYDE_MODEL`, `ANTHROPIC_ANSWER_MODEL`, `RAG_MIN_RERANK_SCORE`, `RAG_TOP_N`, `RAG_TOP_K`.

---

## 13. Tesztelési stratégia

- **Unit (vitest, kulcs nélkül):** `chunker.spec.ts` (a kiemelt egység), `providers.spec.ts` (fake DI), `store.spec.ts` (SQL-építés/param — pg mockolva vagy integrációs jelöléssel), `retrieve.spec.ts` (raw vs full sorrend fake providerrel), `answer.spec.ts` (küszöb-logika: van/nincs találat).
- **Integráció (opcionális, kulccsal, a felhasználó futtatja):** `rag:index` a valós korpuszon + `rag:golden` a valós pipeline-nal → `GOLDEN-SET.md`.
- **Verifikáció:** a Phase 0 (PR #13 merge) után a teljes meglévő teszt-suite zöld; a RAG unit-tesztek zöldek; a golden-set az end-to-end bizonyíték (felhasználói futás).

---

## 14. Kockázatok / nyitott pontok

- **pgvector image-váltás:** a meglévő volume már inicializált; a `CREATE EXTENSION` a migrációban fut (nem az initdb-ben). A RO role SELECT-je a default privileges-ből jön — ellenőrizni kell, hogy az új táblára is érvényes (ha nem, explicit GRANT a migrációban).
- **Prisma + vector típus:** a `vector` nem natív Prisma-típus → `Unsupported("vector(1536)")` a sémában, a vektor-műveletek `pg` raw SQL-lel (a meglévő `runSql`-mintához illően). Az embeddinget nem Prisma-kliensen írjuk.
- **Nyelvi híd:** a magyar kérdés → angol korpusz retrieval a HyDE-ra és az embedding többnyelvűségére támaszkodik; a golden-set ezt empirikusan igazolja.
- **Rerank-átrendezés nem garantált:** ha a nyers sorrend már jó, a report ezt is elfogadható eredményként dokumentálja (a feladat ezt kifejezetten megengedi).
