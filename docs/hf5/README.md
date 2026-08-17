# HF5 — Plantbase Ügyfélsegéd (ügyfélirányú PoC)

A meglévő, belső Plantbase agent **kifelé fordítva**: a webshop **vásárlója** kérdez tőle
(nem a lakberendező). 24/7 önkiszolgáló válasz a katalógus- és gondozási kérdésekre, és
**bizonytalanságnál emberhez irányítás** — a jegyet egy kolléga hagyja jóvá / veszi át.

Ez nem új rendszer: a meglévő agentre, tudásbázisra és tool-készletre épül, egy vásárlói
prompt + egy `escalateToHuman` tool + két CLI-parancs hozzáadásával.

## Mit csinál

- **Megold 4 fájdalmat** (a HF5 tíz fájdalmából): **1** (munkaidőn kívüli válasz),
  **2** (napi ismétlődő kérdések önkiszolgálva), **8** (triage: a valódi/sürgős ügy kontextussal
  emberhez), **9** (konzisztens, forrásolt válasz).
- **Kimondottan NEM old meg**: **4** (rendelés-státusz — nincs rendelési adat a rendszerben),
  **10** (néma lemorzsolódás — nincs CRM/viselkedési jel).

## Mi kell hozzá

1. **Node 22** (`nvm use 22`; a repó `.nvmrc`-je 22).
2. **`.env`** kitöltve (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `JINA_API_KEY`, Postgres-jelszavak) —
   lásd [.env.example](../../.env.example).
3. **Adatbázis** felindexelve:
   ```bash
   docker compose up -d          # lokális Postgres (pgvector)
   pnpm cli rag:index            # a tudásbázis (docs/knowledge/**) beágyazása
   ```
   A katalógus (`products`) a seedből jön; a tudásbázis a `rag:index` után áll készen.

## Hogyan indul

```bash
pnpm cli segit     # vásárlói (ügyfélirányú) session — auto-válasz vagy eszkaláció (kilépés: exit)
pnpm cli sor       # az eszkalációs jegysor read-only nézete (audit + mérés)
```

## Demó-forgatókönyv (a `segit` session)

A demó három fordulót visz végig: egy rutin katalógus-kérdést (auto-válasz), egy gondozási
kérdést (forrásolt válasz), és egy hatókörön kívüli kérdést (**eszkaláció → emberi handoff**).

```
🌱 Plantbase ügyfélsegéd — AI-asszisztenssel beszélsz (nem élő ügyintéző).
   Kérdezz növényről, árról, készletről, gondozásról. Kilépés: exit

te> mi a legolcsóbb kaktusz, ami raktáron van?
segéd> A legolcsóbb raktáron lévő kaktusz a(z) … (ár, készlet) …          ← auto-válasz (runSql)

te> hogyan gondozzam a szobapálmát?
segéd> … forrásolt válasz a tudásbázisból (cím + URL) …                   ← auto-válasz (searchKnowledge, grounded)

te> hol tart a rendelésem, mikor érkezik a csomag?
segéd> Ezt egy kollégám tudja megnézni — továbbítottam neki, hamarosan jelentkezünk.

──────────────── 🔔 ESZKALÁCIÓ — emberi jóváhagyás ────────────────
   Jegy:            esc_ab12cd34
   Ok:              hatókörön kívüli (rendelés/panasz/fizetés/garancia)
   Vásárló kérdése: „hol tart a rendelésem, mikor érkezik a csomag?"
   AI összefoglaló: A vásárló a rendelése státuszát kérdezi — nincs rá adat, ember kell.
   Próbált tool-ok: —
────────────────────────────────────────────────────────────────
Kolléga döntése — [j]óváhagy+átvesz / [e]lutasít (vissza az AI-nak) / [v]álasz: j
✅ Ember átvette, jegy esc_ab12cd34 lezárva.

te> exit
Viszlát!
```

Ezután a jegysor:

```bash
$ pnpm cli sor
Eszkalációs jegysor: 1 összes · 0 nyitott · 1 lezárt
Ok szerint:
  1×  hatókörön kívüli (rendelés/panasz/fizetés/garancia)
Jegyek:
  🟢 LEZÁRT   esc_ab12cd34  [hatókörön kívüli (rendelés/panasz/fizetés/garancia)]
     „hol tart a rendelésem, mikor érkezik a csomag?"
     → jóváhagyva — ember átvette (operator)
```

> **Az eszkaláció tényleg embert hív:** a handoff élő, begépelt emberi döntés (`j`/`e`/`v`), és a
> döntés a jegysorba kerül. Az `[e]lutasít` a **visszavonás** (a jegy `rejected`, vissza az AI-nak).

## Az emberi jóváhagyási pont

Az eszkalált jegynél a kolléga a döntés előtt látja a **teljes kontextust** (vásárlói kérdés, ok,
AI-összefoglaló, próbált tool-ok), és három döntése van:

| Döntés         | Jelentés                                          | Napló                |
| -------------- | ------------------------------------------------- | -------------------- |
| `[j]` approved | átveszi és jóváhagyja a jegyet                    | `resolved: approved` |
| `[e]` rejected | **visszavonja** az eszkalációt (vissza az AI-nak) | `resolved: rejected` |
| `[v]` answered | saját választ ír a vásárlónak                     | `resolved: answered` |

## Architektúra (a meglévőre építve)

| Réteg                             | Fájl                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Eszkalációs tool (DI)             | [escalate-to-human.ts](../../packages/core/src/lib/tools/escalate-to-human.ts)           |
| Jegysor (append-only JSONL)       | [escalation-queue.ts](../../packages/core/src/lib/shared/escalation-queue.ts)            |
| Vásárlói prompt + confidence gate | [customer-system-prompt.ts](../../packages/core/src/lib/agent/customer-system-prompt.ts) |
| Tool-bekötés (opcionális sink)    | [agent-tools.ts](../../packages/core/src/lib/tools/agent-tools.ts)                       |
| Agent (opcionális system + sink)  | [ask-agent.ts](../../packages/core/src/lib/agent/ask-agent.ts)                           |
| CLI (`segit` + `sor` + handoff)   | [main.ts](../../apps/cli/src/main.ts)                                                    |

**Kulcs-invariáns:** az eszkaláció **fájlba ír** (`tickets/`), **nem DB-be** — az agent SQL-je
read-only marad (`SELECT`-guard + read-only DB-role). A két DB-jog határát nem mossuk össze.

## Mi NEM része a rendszernek (scope)

- Nincs rendelési / CRM / fizetési adat és integráció (ezért nem oldja a 4./10. fájdalmat).
- Nincs webes/hangfelület — a PoC CLI, a meglévő belépési minta szerint.
- Nincs perzisztens felhasználó-azonosítás/auth; a session memóriában él.
- Az eszkalációs sor fájl-alapú (nem CRM-ticket-rendszer) — PoC-szintű, de auditálható.
- A prompt nem biztonsági határ; a kemény korlát (read-only SQL) kódban/DB-role-ban van.
- **PII-szűrés még nincs** a provider-hívás/naplózás előtt — ez az 1. GDPR pilot-feladat.

## Tesztek

```bash
pnpm vitest run packages/core     # 52 teszt, benne:
#  - escalation-queue.spec.ts   (append/fold/állapotátmenet, mkdtempSync izolálva)
#  - escalate-to-human.spec.ts  (a tool fake sinkkel)
#  - customer-agent.spec.ts     (determinisztikus eszkaláció-routing, generateText mock — hálózat nélkül)
```

> Az **élő** LLM-demó (`pnpm cli segit`) hálózatot igényel (Anthropic/OpenAI/Jina). A
> determinisztikus tesztek hálózat nélkül is bizonyítják az eszkalációs plumbingot.

## A HF5 többi leadandója

- **Prezentáció (business case)** — [prezentacio.html](prezentacio.html) (8 dia; adattérkép,
  rollout, mérési terv). Böngészőben lapozható (← →), világos/sötét témával, saját arculattal.
- **Logó / arculat** — [assets/plantbase-logo.svg](assets/plantbase-logo.svg) (lockup),
  [assets/plantbase-mark.svg](assets/plantbase-mark.svg) (jel),
  [assets/plantbase-icon.svg](assets/plantbase-icon.svg) (app-ikon/favicon). Lapos vektor,
  szimmetrikus hármas hajtás a „base" vonalból; botanikus zöld + terrakotta. A deck színvilága
  és betűtípusa (serif fejlécek + sans törzs) ehhez igazodik.
- **Mérési terv (teljes)** — [meresi-terv.md](meresi-terv.md).
- **Kérdéslap** — [kerdeslap.md](kerdeslap.md) (6 kapott + 2 saját kényes kérdés).
- **Design-spec** — [../superpowers/specs/2026-08-17-hf5-ugyfel-poc-design.md](../superpowers/specs/2026-08-17-hf5-ugyfel-poc-design.md).
