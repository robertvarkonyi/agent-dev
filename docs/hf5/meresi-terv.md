# Plantbase Ügyfélsegéd — mérési terv (teljes)

> A prezentáció mérési-terv diájának teljes változata. Két elv fut végig rajta:
> **minden sorhoz létező (vagy a pilotra bekötendő) adatforrás**, és **a hibát is mérjük, nem
> csak a sikert**. A célértékeket a pilot kalibrálja — most a mérés _módját_ rögzítjük, nem a
> számokat ígérjük.

## Adatforrások (ma a PoC-ban)

- **Agent-napló** — `logs/<YYYY-MM-DD>.jsonl`, append-only. Kérdésenként egy rekord: teljes
  kérdés, válasz, generált SQL, eredménysorok, modell, token-felhasználás
  ([logger.ts](../../packages/core/src/lib/shared/logger.ts)). Az eszkaláció is ide kerül
  (`escalateToHuman:<reason>` az SQL-mezőben — audit).
- **Eszkalációs jegysor** — `tickets/<YYYY-MM-DD>.jsonl`, append-only event-log (`created` /
  `resolved`). Ok (`reason`), vásárlói üzenet, összefoglaló, és a kolléga döntése
  (`approved` / `rejected` / `answered`)
  ([escalation-queue.ts](../../packages/core/src/lib/shared/escalation-queue.ts)). A
  `pnpm cli sor` ebből számol nyitott/lezárt/ok-szerinti bontást.

## A tábla

| #   | Mit mérünk                                                                              | Honnan lesz adat                                  | Hogyan riportáljuk           | Kinek         | Típus           | Ma naplózva?                                           |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- | ------------- | --------------- | ------------------------------------------------------ |
| 1   | **Válaszidő az ügyfél felé** (kérés → első/teljes válasz)                               | agent-napló (időbélyeg-különbség)                 | heti automatikus összesítő   | folyamatgazda | fájdalom (1, 2) | **részben** — időbélyeg van, a latencia-mező bekötendő |
| 2   | **Önkiszolgálási arány** = eszkaláció nélkül megoldott kérdések / összes                | agent-napló (összes) − jegysor (eszkalált)        | heti                         | folyamatgazda | fájdalom (2)    | igen                                                   |
| 3   | **Off-hours lefedettség** = munkaidőn kívül érkezett és megválaszolt kérdések           | agent-napló (időbélyeg)                           | havi dia                     | szponzor      | fájdalom (1)    | igen                                                   |
| 4   | **Eszkalációs arány** (és ok szerinti bontás)                                           | jegysor (`created` / összes)                      | havi dia a vezetői riportban | szponzor      | fájdalom (8)    | igen                                                   |
| 5   | **Forrás nélkül kiment / grounded=false-t figyelmen kívül hagyó válasz**                | napló-audit (heti mintavétel a tudás-válaszokból) | havi                         | folyamatgazda | **agent-hiba**  | részben — a grounded-jelző bekötendő a naplóba         |
| 6   | **Túl-eszkaláció** = a kolléga `rejected`-ként zárja („ezt az AI is megoldhatta volna") | jegysor (`resolved.action = rejected` / összes)   | havi                         | szponzor      | **agent-hiba**  | igen                                                   |
| 7   | **Emberi felülírási/válasz-arány** = `answered` a lezárt jegyeken                       | jegysor (`resolved.action`)                       | havi                         | folyamatgazda | felügyelet      | igen                                                   |
| 8   | **CSAT a lezárt beszélgetésre** (elégedettség)                                          | rövid 1-kérdéses kérdőív a válasz végén           | havi                         | szponzor      | fájdalom (9)    | **nem** — a pilotra bekötendő                          |
| 9   | **Token-költség / beszélgetés**                                                         | agent-napló (token-breakdown) × listaár           | havi                         | szponzor      | költség         | igen                                                   |

## Metrika-definíciók

1. **Válaszidő** — a vásárlói üzenet beérkezése és a válasz elkészülte közti idő. A naplóban ma a
   rekord `timestamp`-je van; a latenciához a kérés-beérkezés időbélyegét is rögzíteni kell
   (kis kiegészítés a `segit` fordulójában). Cél: a self-service válasz másodpercek, az
   off-hours kérdésé „azonnal a korábbi másnap helyett".
2. **Önkiszolgálási arány** — a fő üzleti mutató a 2. fájdalomra. Magas érték = a kollégákról
   levett teher. A pilot kalibrálja a reális küszöböt.
3. **Off-hours lefedettség** — a munkaidőn kívül érkezett kérdések aránya, amelyekre azonnal jött
   válasz (1. fájdalom). Konzervatív ökölszám a tervezéshez: a kérdések ~30%-a esik munkaidőn
   kívülre.
4. **Eszkalációs arány** — nem „rossz", ha magas: a triage lényege (8. fájdalom), hogy a valódi
   ügy emberhez kerüljön. Ok szerint bontva mutatja, mi hiányzik a rendszerből (pl. sok
   `out_of_scope` a rendelés-státuszra → adat-bővítés indokolt).
5. **Forrás nélkül kiment válasz (agent-hiba)** — a legfontosabb minőségi mutató: a groundolás
   invariánsa, hogy a tudás-válasz forrás nélkül soha ne menjen ki. A `searchKnowledge`
   `grounded` jelzőjét a naplóba kell írni, hogy mintavétel nélkül is auditálható legyen.
6. **Túl-eszkaláció (agent-hiba)** — ha a kolléga `rejected`-ként zár, az AI feleslegesen hívott
   embert. Ez méri a confidence gate „túl óvatos" hibáját (a 2. metrika párja: az egyik a túl
   sok auto-választ, a másik a túl sok eszkalációt bünteti).
7. **Emberi felülírás** — hány jegyet old meg maga a kolléga (`answered`) a puszta átvétel
   (`approved`) helyett; a felügyelet tényleges terhét mutatja.
8. **CSAT** — a 9. fájdalomhoz (konzisztens, jó élmény). A pilotra bekötendő egy egy-kérdéses
   visszajelzés.
9. **Token-költség** — a napló `tokenBreakdown`-jából providerenként; listaáron forintosítva
   (felső becslés). Mért alap: egy gondozási beszélgetés ~10 900 token (a repó token-riportja).

## Ami ma nincs naplózva → mit kell hozzá beépíteni

- **Válaszidő-latencia** — a kérés-beérkezés időbélyege a naplórekordba (kis kiegészítés).
- **`grounded` jelző a naplóba** — a `searchKnowledge` eredményének `grounded` mezője kerüljön a
  napló-rekordba, hogy az 5. metrika mintavétel nélkül is auditálható legyen.
- **CSAT** — egy-kérdéses visszajelzés a beszélgetés végén (a `segit` folyamatba).

## Riport-ritmus

- **Heti** (folyamatgazda): 1., 2. metrika — automatikus összesítő a `logs/` + `tickets/`
  fájlokból.
- **Havi** (szponzor, egy dia): 3.–6., 8., 9. metrika — a vezetői riportba.
