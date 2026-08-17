# HF5 — Ügyfélirányú PoC: ügyfélsegéd + emberi eszkaláció (design)

> Státusz: jóváhagyott terv (2026-08-17). A HF5 záró házi PoC-jának specifikációja.
> A meglévő Plantbase agentet fordítja **kifelé, a webshop vásárlója felé** — nem újraírás,
> hanem **új bejárat** a meglévő agenthez, tudásbázishoz és tool-készlethez.

## 1. Cél és use case

A mai rendszer befelé néz: a **lakberendező** (az agent felhasználója) kérdez a katalógusról és a
gondozási tudásbázisról. A HF5 kiterjesztés a webshop **saját vásárlóját** teszi felhasználóvá:
egy **24/7 ügyfélsegéd**, amely

1. auton­óm választ ad a rutin **katalógus**- (ár, készlet, méret, csomag) és **gondozási**
   kérdésekre a meglévő tool-okkal (`runSql`, `listCategories`, `searchKnowledge`), és
2. **bizonytalanságnál nem találgat, hanem emberhez irányít**: egy új `escalateToHuman` tool
   handoff-jegyet ír egy sorba, ahol egy **kolléga hagyja jóvá / veszi át** a beszélgetést.

Az agent-mag, a promptolt tool-loop és a RAG-pipeline változatlan; a PoC egy vásárlói personát,
egy confidence gate-et, egy eszkalációs toolt és két CLI-parancsot ad hozzá.

## 2. Megoldott és nem megoldott fájdalmak (a 10-ből)

**Megoldja:**

- **1 — munkaidőn kívüli válasz.** Az ügyfélsegéd 24/7 elérhető, a rutinkérdést azonnal megoldja.
- **2 — napi ismétlődő kérdések.** Az önkiszolgáló válasz leveszi a kollégákról a százszor
  megválaszolt „mennyibe kerül / raktáron van-e / hogyan gondozzam" kérdéseket.
- **8 — a sürgős ügy beragad a triviális mögé.** A confidence gate **triage**-ként működik: a
  rutinkérdés azonnal megoldódik, a valódi/hatókörön kívüli ügy **kontextussal** kerül emberhez,
  nem áll ugyanabban a sorban, mint a „nyitvatartás".
- **9 — ki-ki mást válaszol.** Egyetlen, forrásmegjelölt, grounded hang: mindenki ugyanazt a
  konzisztens választ kapja, a gondozási állításokhoz forrással.

**Nem oldja meg (kimondva):**

- **4 — a vásárló nem látja, hol tart az ügye.** Nincs rendelési/ügy-státusz adat a rendszerben
  (a katalógus + tudásbázis nem tartalmaz rendelést). Ez adat-tengelyű bővítés lenne (lásd a HF4
  AI-Act elemzés „rendelési adat hozzáférés" pontját), nem e PoC része.
- **10 — néma lemorzsolódás.** Nincs viselkedési/CRM-jel (rendelési gyakoriság, e-mail-nyitás),
  amiből churn-t lehetne előre jelezni.

A PoC tehát **négy** fájdalmat old meg (a kötelező kettő helyett), és **kettőt** kimondottan nem.

## 3. Architektúra

### 3.1 Új komponensek

| Komponens               | Fájl                                                    | Felelősség                                                                                               | Függőség              |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------- |
| Eszkalációs sor (queue) | `packages/core/src/lib/shared/escalation-queue.ts`      | Append-only JSONL esemény-napló (`created` / `resolved`), + fold a jegyek aktuális állapotára            | `node:fs`             |
| `escalateToHuman` tool  | `packages/core/src/lib/tools/escalate-to-human.ts`      | AI SDK tool; DI-vel kap egy `EscalationSink`-et, jegyet hoz létre, megerősítést ad vissza                | `ai`, `zod`           |
| Vásárlói system prompt  | `packages/core/src/lib/agent/customer-system-prompt.ts` | Vásárló-persona + Art. 50 közlés + confidence gate (mikor válaszol, mikor eszkalál)                      | —                     |
| Fájl-alapú sink         | `apps/cli` (a `main.ts`-ben)                            | Az `EscalationSink` éles megvalósítása: a sorba ír + a fordulóban létrejött jegyeket gyűjti a handoffhoz | `escalation-queue.ts` |

### 3.2 Módosuló komponensek (visszafelé kompatibilisen)

- `packages/core/src/lib/tools/agent-tools.ts` — `buildTools(collector, tracker, escalateSink?)`:
  ha kap sinket, felveszi az `escalateToHuman` toolt. Sink nélkül a viselkedés **változatlan**
  (a lakberendező-útvonal és minden meglévő teszt érintetlen).
- `packages/core/src/lib/agent/ask-agent.ts` — `streamChat(messages, model?, system?, escalateSink?)`
  és `askAgent(input, model?, system?, escalateSink?)`: opcionális `system` (alap: `SYSTEM_PROMPT`)
  és opcionális sink. Meglévő 1-2 argumentumos hívások változatlanul működnek.
- `packages/core/src/index.ts` — új export: `CUSTOMER_SYSTEM_PROMPT`, queue-típusok/függvények,
  `EscalationSink`, `EscalationTicket`.
- `apps/cli/src/main.ts` — két új parancs: `segit`, `sor`.

### 3.3 Az eszkalációs sor formátuma (event-sourced, append-only)

Fájl: `tickets/<YYYY-MM-DD>.jsonl` (a `logs/` mintájára, gitignore-olt). Soronként egy esemény:

```jsonc
// created
{ "type": "created", "ticketId": "esc_...", "ts": "2026-08-17T...", "reason": "out_of_scope",
  "customerMessage": "hol tart a rendelésem?", "summary": "A vásárló a rendelése státuszát kérdezi…",
  "triedTools": ["searchKnowledge"] }
// resolved
{ "type": "resolved", "ticketId": "esc_...", "ts": "2026-08-17T...", "action": "approved|rejected|answered",
  "by": "operator", "note": "Átvettem, e-mailben válaszolok." }
```

A `foldTickets(events)` a `ticketId` szerint összevonja: az aktuális állapot `open`, amíg nincs
`resolved` esemény. A `rejected` = az eszkaláció **visszavonása** (az AI-nak visszaadva). Ez adja a
Q3-hoz a „mit tud visszavonni utána" választ, és a `sor` audit/mérési nézetet.

### 3.4 Read-only invariáns

Az `escalateToHuman` **nem** ír adatbázisba: kizárólag a fájl-alapú sorba append-el. Az agent
`runSql`-je változatlanul a read-only kapcsolaton, SELECT-guard mögött fut. A két DB-jog és a
kód-szintű guard sértetlen — a `biztonsagi-ellenor` invariánsát nem mossuk össze.

## 4. Confidence gate (a vásárlói prompt szabályai)

Az `escalateToHuman` hívás feltételei (a `customer-system-prompt.ts`-ben, XML-tagelt szabályok):

- **Auto-válasz** (nincs eszkaláció): katalógus-kérdés (ár/készlet/méret/csomag) → `runSql`/
  `listCategories`; gondozási kérdés → `searchKnowledge`, **ha** `grounded=true`.
- **Eszkalál** (`escalateToHuman`), ha:
  - `searchKnowledge` `grounded=false` (nincs fedő forrás) — nem talál ki tényt;
  - **hatókörön kívüli**: rendelés/szállítás státusz, panasz, visszáru, fizetés, garancia, számla;
  - **kereskedelmi elköteleződés**: félretétel, egyedi kedvezmény, ártárgyalás;
  - egy tisztázó visszakérdezés után is **kétértelmű** a kérés;
  - a vásárló **kifejezetten embert kér**.
- **Mindig:** Art. 50 közlés (AI-asszisztens); soha kitalált tény/forrás; a `reason` mezőt a fenti
  kategóriákból választja, a `summary`-ben tömören összefoglalja a beszélgetést a kollégának.

## 5. CLI folyamat

### `pnpm cli segit` — vásárlói session (fő demo)

1. Art. 50 banner: „🌱 Plantbase ügyfélsegéd — AI-asszisztenssel beszélsz…".
2. Streamelő válasz `streamChat(history, model, CUSTOMER_SYSTEM_PROMPT, sink)`-kel.
3. Ha a fordulóban létrejött jegy (a sink gyűjti), a session **operátor-nézetre vált**:
   kiírja a jegy kontextusát (vásárlói kérdés, ok, összefoglaló, próbált tool-ok), majd a
   kolléga dönt: `[j]óváhagy+átvesz` / `[e]lutasít (vissza az AI-nak)` / `[v]álasz beírása`.
   A döntés `resolved` eseményként a sorba kerül.

### `pnpm cli sor` — read-only jegysor-nézet (audit + mérés)

A `tickets/*.jsonl` eseményeket folddal összevonja, kiírja a nyitott/lezárt jegyeket és az
eszkalációs statisztikát (összes / nyitott / lezárt, ok szerinti bontás). Csak olvas.

## 6. Tesztelés (TDD, konvenciok.md szerint)

- `escalation-queue.spec.ts` — append + fold + állapotátmenetek, `mkdtempSync`-kel izolált FS.
- `escalate-to-human.spec.ts` — a tool fake sinkkel: jegy jön létre, a visszaadott alak helyes,
  hiba esetén nem dob (beszédes hibaszöveget ad, mint a `searchKnowledge`).
- A meglévő tesztek változatlanul futnak (a `buildTools`/`streamChat` bővítés opcionális-argumentumos).
- LLM-routing: a repó `agent-eval` mintáját követő, pár vásárlói golden kérdés (opcionális, kézi).

## 7. Üzleti leadandók

- `docs/hf5/prezentacio.html` — self-contained 6-8 diás vezetői deck (adattérkép, rollout, mérési
  terv diákkal), Artifactként is publikálva előnézetre.
- `docs/hf5/meresi-terv.md` — teljes mérési tábla; ≥1 metrika a megoldott fájdalmakhoz kötve, ≥1 az
  **agent hibáját** méri; forrásjelölés (mért/becsült/ökölszám); „mit kell hozzá naplózni".
- `docs/hf5/kerdeslap.md` — a 6 kapott + 2 saját kényes kérdés, egy-egy bekezdéses válasszal.
- `docs/hf5/README.md` — mit csinál, hogyan indul (`segit`/`sor`), mi kell hozzá; link a fő README-ből.

## 8. Scope — mi NEM része

- Nincs rendelési/CRM/fizetési adat és integráció (ezért nem oldja a 4./10. fájdalmat).
- Nincs webes/hangfelület — a PoC CLI, a meglévő belépési minta szerint.
- Nincs perzisztens felhasználó-azonosítás/auth; a session memóriában él.
- Az eszkalációs sor fájl-alapú (nem üzenetsor/CRM-ticket-rendszer) — PoC-szintű, de auditálható.
- A prompt nem biztonsági határ: a kemény korlát (read-only SQL) kódban/DB-role-ban van.
