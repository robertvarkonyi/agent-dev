# Plantbase — ROI egy lakberendező szemszögéből

> Rövid, számokkal alátámasztott levezetés arról, mennyi időt és pénzt spórol a
> Plantbase agent egy lakberendezőnek. A keret az [1. óra Hard/Soft ROI]
> logikája; az üzleti háttér a [brs-plantbase.md](brs-plantbase.md).
>
> **Elv:** minden feltevés **konzervatív** (inkább alábecslünk). A cél nem a
> legszebb szám, hanem egy olyan, amit egy ügyfél előtt is meg lehet védeni.

## 1. A probléma, forintosítva

A lakberendező minden szobához kézzel állítja össze a növénycsomagot:
webshop-keresgélés, méricskélés (belefér-e a térbe), raktárkészlet- és
akció-ellenőrzés, büdzsé-illesztés. Az adat megvan, de a kinyerése aprómunka,
és SQL-tudást vagy elemzőt igényelne.

A Plantbase-szel ugyanez természetes nyelvű kérdés → azonnali, pontos válasz.

## 2. Feltevések (a persona tipikus hónapja)

| Paraméter | Érték | Forrás |
|---|---|---|
| Ügyfelek / hó | 5 | BRS |
| Szoba / ügyfél (átlag) | 3 | BRS |
| **Szoba / hó** | **15** | 5 × 3 |
| Kézi idő / szoba (ma) | 10–15 perc → **12 perc** átlag | BRS |
| Agenttel / szoba (KPI) | **5 perc** (a válasz másodpercek, +átnézés/kurálás) | BRS sikerkritérium |
| **Megtakarítás / szoba** | **7 perc** | 12 − 5 |
| Lakberendező óradíja | **10 000 Ft/óra** (konzervatív; l. 5. pont) | piaci becslés |

Az 5 perc szándékosan a KPI felső határa: a modell másodpercek alatt válaszol,
a fennmaradó időt a lakberendező az eredmény átnézésére/kurálására fordítja.

## 3. Időmegtakarítás

```
Havi megtakarítás  = 15 szoba × 7 perc = 105 perc ≈ 1,75 óra / hó
Éves megtakarítás  = 1,75 óra × 12     = 21 óra / év
```

Másképp: a kézi ráfordítás havi ~2,5–3,75 óráról (15 szoba × 10–15 perc)
**~1,25 órára** esik (15 × 5 perc) — a munka nagyjából **fele-kétharmada**
eltűnik.

## 4. Pénzbeli megtakarítás (Hard ROI)

```
Havi = 1,75 óra × 10 000 Ft = 17 500 Ft / hó
Éves = 21   óra × 10 000 Ft = 210 000 Ft / év
```

### Levonva az agent üzemeltetési költségét

Az agent az Anthropic `claude-sonnet-4-6` modellen fut
(3 USD / 1M input, 15 USD / 1M output token). Egy szoba összeállítása jellemzően
néhány kérdés + a tool-use loop (SQL-generálás → eredmény → válasz).
Bőven felülbecsülve ~8 000 input és ~1 000 output token / szoba:

```
Token-költség / szoba ≈ 8 000 × 3$/1M + 1 000 × 15$/1M
                      ≈ 0,024$ + 0,015$ ≈ 0,04$  (~15 Ft, 360 Ft/USD-vel)

Havi API-költség ≈ 15 szoba × ~15 Ft ≈ ~225 Ft / hó
                  (kerekítve, tartalékkal: < 1 000 Ft / hó)
```

Az API-költség **nagyságrendekkel** kisebb a megtakarított munkaidő értékénél
— a nettó eredmény gyakorlatilag a bruttó:

| | Havi | Éves |
|---|---|---|
| Megtakarított munkaidő értéke | 17 500 Ft | 210 000 Ft |
| − Agent API-költség | ~225 Ft | ~2 700 Ft |
| **Nettó Hard ROI** | **~17 300 Ft** | **~207 000 Ft** |

A lokális Postgres (docker-compose) saját gépen fut, nincs felhő-DB díj.

## 5. Érzékenységvizsgálat (óradíj × megtakarítás)

Az egyetlen igazán bizonytalan bemenet az óradíj. A megtakarítás **éves**
értéke (21 óra körül) különböző feltevések mellett:

| Óradíj \ Megtak. | 6 perc/szoba (18 ó/év) | 7 perc/szoba (21 ó/év) | 9 perc/szoba (27 ó/év) |
|---|---|---|---|
| **8 000 Ft/ó** | 144 000 Ft | 168 000 Ft | 216 000 Ft |
| **10 000 Ft/ó** | 180 000 Ft | **210 000 Ft** | 270 000 Ft |
| **15 000 Ft/ó** | 270 000 Ft | 315 000 Ft | 405 000 Ft |

A legpesszimistább sarok is **~144 000 Ft/év** — az API-költség itt is elenyésző.

## 6. Soft és másodlagos ROI (nem forintosítjuk, de valós)

- **Olcsóbb kosár (potenciális Hard):** az agent ugyanazt olcsóbban vagy jobb
  ár-érték alternatívát talál, és figyeli az akciókat → alacsonyabb beszerzési
  költség. Ezt szándékosan **nem** számoltuk a fő ROI-ba, mert gyakran az
  ügyfélre hárul; de tiszta felfelé mutató kockázat.
- **Magasabb ügyfélélmény:** gyorsabb, pontosabb ajánlat percek alatt.
- **Jobb minőségű munka:** pontosabb illeszkedés a tér (fény, méret) és az
  ügyfél igényeihez, kevesebb emberi hiba a méricskélésnél/készletnél.

## 7. Összefoglaló

| Mutató | Érték |
|---|---|
| Idő / szoba | 12 → **5 perc** (KPI) |
| Megtakarított idő | **~1,75 óra/hó, ~21 óra/év** |
| Nettó pénzbeli megtakarítás | **~17 300 Ft/hó, ~207 000 Ft/év** (10 000 Ft/ó mellett) |
| Agent üzemeltetési költség | **< 1 000 Ft/hó** |
| Megtérülés | gyakorlatilag azonnali — a költség a haszon töredéke |

A skálázódással (több felhasználó, ecommerce/ügyfélszolgálat/logisztika,
későbbi ajánlás-történet) ugyanez a minta — LLM + tool + adat — nagyobb
volumenen ismétlődik, változatlanul alacsony egységköltséggel.
