# Plantbase RAG — inkrementális újraindexelés (architektúra-terv)

> **Ez a dokumentum TERV**, nem egy már kész funkció leírása. A tudásbázis mai indexelése
> (`pnpm cli rag:index`) ma is **teljes újraolvasást** futtat a `docs/knowledge/*.md` fájlokon —
> de a mögötte lévő `ingestDocs` függvény már ma is tartalmazza az inkrementalitás **magját**
> (hash-alapú skip + törölt-doksi reconcile). Ez a doksi azt írja le, hogyan áll össze ebből egy
> teljes inkrementális újraindexelési folyamat, mi van belőle **már megvalósítva**, és mi **hiányzik
> még** (trigger-automatizmus, modell-verziózás, egy ismert edge case javítása).
>
> Jelölés: **[MEGVALÓSÍTVA]** = a hivatkozott kód ma is pontosan ezt csinálja (fájl:függvény szerint
> ellenőrizve). **[TERV]** = ma még nincs megírva, ez a dokumentum a javasolt megoldást írja le.

## Áttekintés — adatfolyam

```
docs/knowledge/*.md
   │  (readdirSync + readFileSync, apps/cli/src/main.ts → ragIndex())
   ▼
{ docId, raw }[]
   │
   ▼
ingestDocs(files, { providers, store, embedModel })     [packages/rag/src/lib/ingest.ts]
   │
   ├─ store.docHashes()                                  → Map<doc_id, content_hash>  [MEGVALÓSÍTVA]
   │      (a jelenlegi DB-állapot pillanatképe: PgStore.docHashes(), store.ts)
   │
   ├─ jelenlévő docId-halmaz (a `files`-ből) vs a tábla docId-halmaz
   │      → a táblában lévő, de a `files`-ből hiányzó doc_id-k törlése  [MEGVALÓSÍTVA]
   │        (store.deleteByDocId(docId), store.ts)
   │
   └─ minden fájlra: hashBody(doc.body) vs a docHashes()-ből kapott tárolt hash  [MEGVALÓSÍTVA]
          ├─ egyezik  → skip, NINCS OpenAI embedding-hívás
          └─ eltér    → chunkDoc → providers.embed → store.upsertDoc(docId, chunks)
                         (upsertDoc: DELETE+INSERT egy tranzakcióban, store.ts)  [MEGVALÓSÍTVA]
```

Az `ingestDocs` a `docs/knowledge/**` teljes fájllistáját kapja meg egy futásban (nem egyetlen
megváltozott fájlt) — az "inkrementalitás" nem abban van, hogy csak a diffet olvassuk be a
lemezről, hanem abban, hogy a **beolvasott teljes halmazból** csak a ténylegesen változott,
illetve új/törölt dokumentumokra történik drága művelet (chunkolás, OpenAI embedding-hívás,
DB-írás). A változatlan dokumentumok a hash-egyezés miatt egyetlen extra API-hívás nélkül,
O(1) map-lookuppal kiesnek.

---

## 1. Honnan tudod, hogy egy dokumentum változott? [MEGVALÓSÍTVA]

A változás-detektálás **tartalom-hash alapú**, nem fájl-mtime vagy git-diff alapú — ez azért
fontos, mert a `pnpm cli rag:index` mindig a `docs/knowledge/` teljes tartalmát olvassa be
(`readdirSync` + `readFileSync`, `apps/cli/src/main.ts`), és a döntést a `ingestDocs` hozza meg
tartalom alapján, nem a fájlrendszer metaadatai alapján. Ez robusztusabb: egy `touch`, egy
whitespace-only mentés vagy egy checkout, ami nem változtatja a törzs tartalmát, nem vált ki
felesleges re-embedet.

**A mechanizmus:**

1. `hashBody(body: string): string` (`packages/rag/src/lib/ingest.ts`) — `sha256` hex digest a
   dokumentum **törzsén** (`doc.body`, azaz a markdown front-matteren/címen túli tartalmi rész,
   amit a `parseDoc` állít elő). Ez a hash kerül a `knowledge_chunks.content_hash` oszlopba
   (Task 1 migráció, `packages/db/prisma/migrations/20260722143646_knowledge_chunks/migration.sql`)
   minden egyes chunk-sorra — egy dokumentum összes chunkja ugyanazt a `content_hash`-t kapja,
   mert a hash a teljes doksi törzsén számolódik, nem chunkonként.
2. `PgStore.docHashes(): Promise<Map<string, string>>` (`packages/rag/src/lib/store.ts`) —
   `SELECT DISTINCT ON (doc_id) doc_id, content_hash FROM knowledge_chunks ORDER BY doc_id,
chunk_index` — egy `doc_id → content_hash` map-et ad vissza a **jelenlegi DB-állapotról**
   (mivel egy dokumentum minden chunkja ugyanazt a hash-t hordozza, elég az első chunk-ot venni).
3. `ingestDocs` minden beolvasott fájlra kiszámolja a friss `hash = hashBody(doc.body)`-t, és
   összeveti a `docHashes()`-ből kapott, tárolt hash-sel:
   `if (existing.get(doc.docId) === hash) { skipped++; continue; }`
   — **egyezés esetén a doksi kimarad a chunkolásból és az embeddelésből is**: nincs
   `providers.embed(...)` hívás, tehát nincs OpenAI-költség és nincs DB-írás sem erre a
   dokumentumra. Ez a "változatlan doksi ne vektorizálódjon újra" garancia konkrét helye a
   kódban.

Eltérés esetén (új doksi vagy megváltozott törzs) a doksi végigmegy a chunk → embed → store
láncon — lásd lent a 2. és a "módosult dokumentum" szekciót.

---

## 2. Mi történik az ÚJ dokumentummal? [MEGVALÓSÍTVA]

Ha egy `doc_id` **nincs benne** a `docHashes()` map-jében (mert még soha nem indexelték), akkor
`existing.get(doc.docId)` `undefined`, ami sosem egyezik semmilyen kiszámolt hash-sel — az
`if (existing.get(doc.docId) === hash)` ág tehát biztosan `false`, a doksi a "változott" ágra esik:

1. `chunkDoc(doc)` (`packages/rag/src/lib/chunker.ts`) feldarabolja a doksit chunkokra.
2. `providers.embed(chunks.map(c => c.content))` lekéri az embeddingeket (OpenAI).
3. `store.upsertDoc(doc.docId, stored)` beírja az új chunkokat — a `PgStore.upsertDoc`
   tranzakcióban fut (`BEGIN` → `DELETE FROM knowledge_chunks WHERE doc_id = $1` → `INSERT` minden
   chunkra → `COMMIT`); új doksinál a `DELETE` nulla sort érint, gyakorlatilag tiszta insert.
4. `indexed++` — az `IngestResult.indexed` számlálóban jelenik meg.

Kivétel: ha egy vadonatúj doksi törzse **0 chunkot** ad (pl. üres vagy csak metaadatot
tartalmazó fájl), a `chunkDoc` üres tömböt ad vissza, és az `ingestDocs` a
`if (chunks.length === 0) { skipped++; continue; }` ágon skippel — nincs mit beszúrni, ez helyes
viselkedés új doksinál (nincs korábbi állapot, amit inkonzisztenciába lehetne hagyni). Lásd
lent a "Ismert edge case" szekciót, ahol ugyanez az ág **meglévő** doksinál problémás.

---

## 3. Mi történik a TÖRÖLT dokumentum chunkjaival? [MEGVALÓSÍTVA]

A törlés-reconcile **halmaz-összevetéssel** történik, még a fő ciklus előtt, `ingestDocs`
elején:

```ts
const present = new Set(files.map((f) => f.docId));
for (const docId of existing.keys())
  if (!present.has(docId)) {
    await store.deleteByDocId(docId);
    deleted++;
  }
```

- `existing` a `docHashes()`-ből kapott map kulcsai — vagyis **minden doc_id, aminek jelenleg
  van legalább egy chunkja a `knowledge_chunks` táblában**.
- `present` a **most beolvasott `files` halmaza** — vagyis ami ténylegesen ott van a
  `docs/knowledge/` mappában ebben a futásban.
- Ha egy `doc_id` benne van a táblában, de **nincs** a most beolvasott fájlok között (mert a
  `.md` fájlt törölték vagy átnevezték a lemezen), a `store.deleteByDocId(docId)`
  (`packages/rag/src/lib/store.ts`, `DELETE FROM knowledge_chunks WHERE doc_id = $1`) törli **az
  adott doksi összes chunkját** — nem csak egyet, hanem az adott `doc_id`-hoz tartozó minden
  sort, mivel a törlés `doc_id`-alapú, nem chunk-id-alapú.

Fontos: mivel a `docId` a fájlnévből származik (`name.slice(0, -3)`, `apps/cli/src/main.ts`),
egy **átnevezés** a reconcile szemszögéből "törlés + új doksi" — a régi `doc_id` chunkjai
törlődnek, az új `doc_id` alatt pedig teljes újraindexelés történik (nincs hash-történet átvitel
átnevezésnél, mert a régi tartalom hash-e egy másik `doc_id` alatt van tárolva).

---

## Módosult dokumentum [MEGVALÓSÍTVA — a meglévő primitívekből összeáll]

A megváltozott (de nem törölt) dokumentum kezelése a fenti 1. és 2. pont logikájának
kombinációja, külön kód nélkül:

1. Az 1. pont szerinti hash-összevetés **eltérést** talál (`existing.get(doc.docId) !== hash`,
   de `existing.get(doc.docId)` **nem** `undefined` — tehát ismert doksi, csak más tartalommal).
2. `ingestDocs` innentől ugyanazt az ágat futtatja, mint az új dokumentumnál: `chunkDoc` →
   `providers.embed` → `store.upsertDoc(doc.docId, stored)`.
3. A **régi chunkok törlése** nem egy külön `deleteByDocId`-hívással történik, hanem magában a
   `PgStore.upsertDoc`-ban: a metódus tranzakcióban előbb `DELETE FROM knowledge_chunks WHERE
doc_id = $1`-et futtat, majd beszúrja az újonnan chunkolt/embeddelt sorokat. Ez egy **atomi
   csere** (replace) — nincs olyan pillanat, amikor a lekérdezés a régi és az új chunkok
   keverékét látná, és crash esetén a tranzakció `ROLLBACK`-el visszaáll (a régi chunkok
   maradnak, a doksi a következő futásnál újra "változottként" fog viselkedni, mert a hash még a
   régi).

Ebből következik egy hasznos robusztussági tulajdonság: **`ingestDocs` idempotens és
megszakítás-tűrő**. Ha a folyamat félbeszakad (pl. az OpenAI-hívás egy doksinál elszáll), az addig
sikeresen `upsertDoc`-olt dokumentumok hash-e már a táblában frissült, tehát egy újrafuttatott
`rag:index` ezeket skippeli, és csak az elakadás óta feldolgozatlan doksikkal folytatja — nincs
szükség checkpoint-mechanizmusra.

---

## 4. Mikor / mi triggereli az újraindexelést? [TERV]

Ma egyetlen trigger létezik: a **manuális** `pnpm cli rag:index` (`apps/cli/src/main.ts`,
`rag:index` parancs, RW pool `DATABASE_URL`-lel). A repóban ma nincs git-hook (`.husky` nincs) és
nincs CI workflow — a `.claude/settings.json` `PostToolUse` hookjai (`dev-workflow.md`) a Claude
Code L1 szerkesztési akcióit fogják meg (prettier, `vitest related`), **nem** a termék futásidejű
vagy adatbázis-műveleteit, tehát azok nem alkalmasak reindex-trigger céljára.

Három trigger-lehetőség és mikor melyik indokolt:

| Trigger                                                                       | Mikor fut                                               | Mikor indokolt                                                                                                                                                                                                                                         | Kockázat / ár                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manuális** `pnpm cli rag:index`                                             | Fejlesztő gépeltje, tetszőleges pillanatban             | Fejlesztés közben, új knowledge-doksi tesztelésekor, egyszeri javításnál                                                                                                                                                                               | Emberi felejtés — ha valaki elfelejti futtatni, a DB elavul a git-tartalomhoz képest                                                                                                            |
| **Git-hook / CI** (`docs/knowledge/**` path-filterrel, `main`-re mergeléskor) | Automatikusan, a merge pillanatában                     | Ez a **javasolt elsődleges trigger** production-höz: determinisztikus, nem emberi memóriától függ, és a hash-skip miatt olcsó — egy CI-futás a teljes `docs/knowledge/`-t újraolvassa, de csak a ténylegesen változott fájlokra hív OpenAI embeddinget | A CI-környezetnek szüksége van `DATABASE_URL`-re (RW titok) — ezt óvatosan kell kezelni (ne PR-buildeken fusson, csak merge-en, hogy PR-forkok ne kapjanak RW DB-hozzáférést)                   |
| **Cron / fájl-watch**                                                         | Időzítve (pl. éjszakánként) vagy fájlrendszer-eseményre | Biztonsági háló olyan esetekre, amikor a CI-trigger kimarad (pl. leállás, manuális DB-módosítás) vagy ha a knowledge-tartalom később nem kizárólag git-flow-n keresztül változik (pl. admin UI)                                                        | Felesleges terhelés ma: a `docs/knowledge/*.md` kizárólag git-en keresztül változik, fájl-watch túlbiztosítás lenne; a cron is csak akkor ad hozzáadott értéket, ha a CI-trigger megbízhatatlan |

**Javaslat:** a CI-trigger legyen az elsődleges (path-filter: `docs/knowledge/**`, csak `main`
branch-en, nem minden PR-pusholáson — a hash-skip miatt egy felesleges CI-futás olcsó, de a
`DATABASE_URL` RW titok PR-buildekre engedése biztonsági kockázat lenne). A manuális
`rag:index` marad a helyi fejlesztői munkafolyamat része. Cron/watch csak akkor kerüljön be, ha a
CI-trigger a gyakorlatban megbízhatatlannak bizonyul, vagy ha a knowledge-forrás kilép a
git-flow-ból.

---

## Modell-verziózás (`embed_model`) [TERV]

A `knowledge_chunks.embed_model` oszlop (Task 1 migráció) minden chunk-sornál eltárolja, **melyik
embedding-modellel** készült a vektor — ez ma a `PgStore.upsertDoc` minden `INSERT`-jébe bekerül
(`c.embedModel`, `deps.embedModel`-ből, ami az `loadRagConfig()` konfigurációból jön), de **ma
semmi nem olvassa vissza és nem hasonlítja össze**.

Ez egy valódi hiányosság, ha a projekt embedding-modellt vált (pl. `text-embedding-3-small` →
`text-embedding-3-large`, vagy dimenzióváltás): a hash-skip **kizárólag** a `content_hash`-t
nézi, a modellt nem — tehát egy modellváltás után futtatott `rag:index` a változatlan tartalmú
doksikat továbbra is skippelné, és a táblában **kevert modellű vektorok** maradnának (régi
doksik a régi modellel, csak a ténylegesen módosított doksik az újjal). Mivel a
`similaritySearch` egyetlen koszinusz-távolság-számítást futtat a teljes táblán, a kevert
embedding-terek **érvénytelen/torz similarity-rangsorolást** adnának — ez csendben romlana, nem
hibázna látványosan.

**Javasolt megoldás — két lehetőség:**

1. **Finomabb, szelektív:** bővíteni a `docHashes()`-t (vagy egy új `Store`-metódust bevezetni),
   hogy `content_hash` mellett `embed_model`-t is visszaadjon
   (`Map<docId, { hash: string; embedModel: string }>`), és a skip-feltételt kiegészíteni:
   `hash egyezik ÉS embedModel egyezik a konfigurált cfg.embedModel-lel`. Így egy modellváltás
   után egyetlen `rag:index` futás automatikusan mindent újra-embeddel, tartalom-változás nélkül
   is — anélkül, hogy a törlés-reconcile logikát érintené.
2. **Egyszerűbb, durvább:** modellváltáskor egy explicit "teljes újraindexelés" művelet — pl. a
   `knowledge_chunks` tábla ürítése (`TRUNCATE` vagy minden `doc_id` `deleteByDocId`-vel törölve)
   közvetlenül `rag:index` előtt —, ami után minden doksi "újként" viselkedik (nincs
   `docHashes()`-bejegyzés), tehát a meglévő, már megvalósított "új dokumentum" ág fut le rájuk.
   Ez a jelenlegi tudásbázis méreténél (néhány tucat–száz doksi) elfogadható ár a kódbonyolultság
   elkerüléséért.

A javaslat a **1. opció** hosszabb távra (nincs szükség operátori kézi lépésre modellváltáskor),
de a **2. opció** is elfogadható átmeneti megoldás, amíg a knowledge-bázis kicsi.

---

## Ismert edge case: doksi 0 chunkra szerkesztve (nem törölve) [TERV — javítandó]

A Task 6 code review-ban azonosított hiányosság, ami a jelenlegi `ingestDocs`-ban **ma is
megvan**:

Ha egy **meglévő** dokumentumot úgy szerkesztenek, hogy a törzse a `chunkDoc` szerint **0
chunkot** ad (pl. minden tartalmat kitörölnek belőle, csak a cím/front-matter marad, de a fájl
maga nem törlődik a lemezről), a következő történik:

1. A doksi **jelen van** a `files` halmazban (`present.has(docId)` igaz) → a törlés-reconcile
   (3. pont) **nem** törli, mert az csak a `files`-ből teljesen hiányzó `doc_id`-kra fut.
2. A hash eltér a tárolttól (a tartalom megváltozott) → a "módosult dokumentum" ágra esik.
3. `chunkDoc(doc)` üres tömböt ad → `if (chunks.length === 0) { skipped++; continue; }` —
   **a ciklus itt kilép, mielőtt bármilyen `store` hívás történne.**

Eredmény: **sem `deleteByDocId`, sem `upsertDoc` nem fut** erre a doksira — a régi (a korábbi,
nem-üres verzióhoz tartozó) chunkjai **bennragadnak** a `knowledge_chunks` táblában, "beragadt"
(orphan) állapotban: a keresés továbbra is visszaadhatja őket, holott a forrás-doksi már nem
tartalmazza ezt az információt, és a `content_hash` is stimmelne egy jövőbeli összevetésnél csak
akkor, ha valaki vissza nem állítja pontosan a régi tartalmat (ami valószínűtlen) — vagyis ez
**nem magától gyógyuló** állapot, csak addig marad, amíg valaki explicit be nem avatkozik.

**Javasolt javítás:** a `chunks.length === 0` ágban, **meglévő** doksinál (`existing.has(doc.docId)`
igaz) explicit `await store.deleteByDocId(doc.docId)`-t kell hívni az `skipped++` előtt/mellett
(és célszerűbb ezt `deleted`-ként számolni, nem `skipped`-ként, hogy az `IngestResult` őszintén
tükrözze, hogy történt törlés). Vázlatosan:

```ts
if (chunks.length === 0) {
  if (existing.has(doc.docId)) {
    await store.deleteByDocId(doc.docId);
    deleted++;
  } else {
    skipped++;
  }
  continue;
}
```

Ez konzisztenssé tenné a viselkedést a 3. ponttal: egy dokumentum "eltűnése" a tudásbázisból
attól függetlenül törlést eredményezzen, hogy a fájl maga tűnt-e el a lemezről, vagy csak a
tartalma ürült ki nullára.

---

## Összefoglaló: mag vs. terv

| Rész                                                          | Státusz                   | Hol                                                              |
| ------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| Tartalom-hash számítás (`hashBody`)                           | MEGVALÓSÍTVA              | `packages/rag/src/lib/ingest.ts`                                 |
| Hash-alapú skip (változatlan doksi nem embeddelődik újra)     | MEGVALÓSÍTVA              | `ingestDocs`, `ingest.ts`                                        |
| Új dokumentum indexelése                                      | MEGVALÓSÍTVA              | `ingestDocs`, `ingest.ts`                                        |
| Törölt dokumentum (fájl eltűnt) reconcile + törlés            | MEGVALÓSÍTVA              | `ingestDocs` + `PgStore.deleteByDocId`, `ingest.ts` / `store.ts` |
| Módosult dokumentum (atomi csere)                             | MEGVALÓSÍTVA              | `PgStore.upsertDoc` (DELETE+INSERT tranzakcióban), `store.ts`    |
| Manuális reindex-belépési pont                                | MEGVALÓSÍTVA              | `pnpm cli rag:index`, `apps/cli/src/main.ts`                     |
| Git-hook / CI trigger `docs/knowledge/**`-re                  | TERV                      | —                                                                |
| Cron / fájl-watch trigger                                     | TERV (alacsony prioritás) | —                                                                |
| Modell-verziózás (`embed_model` alapú kényszerített re-embed) | TERV                      | `embed_model` oszlop már létezik, de nincs kiolvasva/összevetve  |
| "0 chunkra ürült, meglévő doksi" törlés-javítás               | TERV — ismert hiba        | `ingestDocs`, `chunks.length === 0` ág                           |
