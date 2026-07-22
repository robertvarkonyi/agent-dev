# Golden Set — raw vs full pipeline

Ez a fájl **generált**: a `pnpm cli rag:golden` parancs futtatáskor felülírja a
`packages/rag/src/lib/golden.ts` `renderGoldenMarkdown` kimenetével (RO DB-kapcsolat,
`DATABASE_URL_READONLY` kell hozzá + a live RAG providerek API-kulcsai).

Ez a placeholder csak addig érvényes, amíg a parancsot élesben le nem futtatják
(lásd Task 12) — **nem tartalmaz kitalált eredményszámokat**.

## A golden kérdéskészlet (`GOLDEN_QUESTIONS`)

| #   | Kérdés                                                   | Megjegyzés                            |
| --- | -------------------------------------------------------- | ------------------------------------- |
| 1   | Milyen fényt igényel a Monstera deliciosa?               | answerable                            |
| 2   | Milyen gyakran öntözzem a kígyónövényt (snake plant)?    | answerable                            |
| 3   | Hogyan szaporítsak pothost dugványról?                   | answerable                            |
| 4   | Miért sárgulnak a növényem levelei?                      | answerable                            |
| 5   | Hogyan szabaduljak meg a gombaszúnyogoktól?              | answerable                            |
| 6   | Miért lyukasak a Monstera / swiss cheese növény levelei? | rerank-átrendezés jelölt              |
| 7   | Melyik szobanövény biztonságos macskák mellé?            | answerable                            |
| 8   | Hogyan gondozzam a húsevő Vénusz légycsapót?             | MEGVÁLASZOLHATATLAN — grounding próba |

## Futtatás

```bash
nvm use 22
pnpm cli rag:index   # egyszer, a docs/knowledge/*.md indexeléséhez (RW)
pnpm cli rag:golden  # a golden-set futtatása, ez a fájl frissül (RO)
```

A live futás után itt egy táblázat jelenik meg soronként a raw (embedding-only) és
a full (HyDE + rerank) top-K találati listával, valamint azzal, hogy a #8 kérdésre
(Vénusz légycsapó) az `answerFromKnowledge` helyesen "NINCS" (grounded: false)
választ ad-e — ez a grounding-próba.
