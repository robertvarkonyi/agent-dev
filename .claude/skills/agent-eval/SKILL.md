---
name: agent-eval
description: >-
  Futtass regressziós kiértékelést (evalt) a Plantbase askAgent-en egy golden
  kérdéskészlettel, és értékeld, mennyire helyesek a válaszok. Használd, amikor
  a system promptot, a modellt, egy tool-t vagy az agent-loopot módosítottad és
  tudni akarod, nem romlott-e el a viselkedés — pl. "értékeld ki az agentet",
  "nem tört-e el valami a prompt után", "fut-e még jól az agent", "csinálj egy
  evalt a válaszokra", vagy mielőtt agent-változtatást mergelnél. A determinista
  unit-tesztek (*.spec.ts) NEM fedik az LLM-viselkedést — erre ez való.
---

# Plantbase agent-eval (regressziós kiértékelés)

A `*.spec.ts` tesztek a determinista magot fedik (guardok, kinyerő függvények),
de az agent **tényleges válaszminőségét** — jó SQL-t generál-e, visszakérdez-e
kétértelműségnél, őszinte-e találat nélkül — nem. Egy prompt- vagy
model-változtatás csendben elronthatja ezt. Ez a skill egy fix golden
kérdéskészleten futtatja a valódi agentet, majd a válaszokat a kritériumok
alapján leosztályozza, és jelzi a regressziót.

A folyamat két lépés: **(1) determinista futtatás** scripttel (élő API + DB),
**(2) grading** — ezt te (Claude) végzed, mert a válaszminőség megítélése nyelvi
feladat, nem string-egyezés.

## 1. Futtatás

Előfeltétel: Node 22, kitöltött `.env` (`ANTHROPIC_API_KEY`,
`DATABASE_URL_READONLY`), és fut a Postgres seedelt katalógussal
(`docker compose up -d`). A futás **valódi API-hívásokat tesz** (token = pénz),
ezért a golden készlet szándékosan kicsi.

```bash
nvm use 22
NODE_OPTIONS=--conditions=@plantbase/source pnpm exec tsx .claude/skills/agent-eval/scripts/run-eval.ts
```

A script minden golden esetre lefuttatja az `askAgent`-et, és ír egy
`logs/eval/<timestamp>/results.json`-t (kérdés, válasz, `usage`, `latency_ms`,
esetleges hiba). A tényleges lefuttatott SQL a szokásos `logs/<timestamp>.jsonl`
interakció-naplókban van, ha rá kell nézned.

## 2. Grading (ezt Claude végzi)

Olvasd be a friss `results.json`-t és a
[golden.json](evals/golden.json)-t, majd **esetenként** ítélj:

- **must_include**: minden felsorolt kulcsszó (kis/nagybetű-független) szerepel
  a válaszban? Ez determinista — ellenőrizd pontosan.
- **should_ask_back**: ha `true`, a jó válasz **visszakérdez** (nem ajánl
  vaktában). Ha a válasz mégis konkrét ajánlást ad hiányzó infónál → bukás.
- **expects**: a válasz teljesíti-e a leírt kritériumot? Itt ítélj tartalmilag
  (a megnevezett termék valóban illik-e a szűrőre, az ár/akció helyes-e stb.).
  Ha bizonytalan vagy, nézd meg a `logs/<timestamp>.jsonl`-ben a generált SQL-t
  és az eredményt — abból eldönthető, hogy a válasz az adatból jött-e vagy
  hallucináció.
- **error**: ha az esetnek van `error` mezője, az automatikus bukás.

Minden esethez adj: **pass / fail**, egy mondatos indoklás, és bukásnál mit
rontott (rossz szűrő, hallucináció, nem kérdezett vissza, üres válasz…).

## Riport formátum

Mindig ezt a szerkezetet add vissza:

```
# Agent-eval — <timestamp> (model: <model>)

Összesítés: X/Y pass. Össztoken: <input+output>. Átlag latencia: <ms>.

## Esetek
- [PASS] kategoriak — a listCategories kategóriáit sorolta fel.
- [FAIL] legolcsobb-kaktusz-raktaron — nem raktáron lévő terméket ajánlott (stock=0).
  ...

## Regressziók / megjegyzések
- <mit érdemes javítani a promptban / toolban, ha van bukás>
```

Ha van korábbi eval-riport ugyanerről a golden készletről, **hasonlítsd össze**,
és emeld ki, mi változott (mi bukott el most, ami korábban ment — ez a valódi
regresszió).

## A golden készlet bővítése

A [golden.json](evals/golden.json) `cases` tömbjébe vegyél fel új esetet, ha egy
bug kicsúszott az evalon, vagy új tool/képesség jött be (pl. a
[new-agent-tool](../new-agent-tool/SKILL.md) skillel). Mezők: `id`, `question`,
`expects`, opcionálisan `must_include` (kulcsszavak) és `should_ask_back`.
Egy jó eset egy konkrét viselkedést pin-el le — a rossz esetekből tanulj:
minden production-bug váljon golden esetté.
