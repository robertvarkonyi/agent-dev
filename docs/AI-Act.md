# HF4: Ki felel, ha az agent hibázik?

> Dokumentum-alapú házi feladat a 9. órához. A kiindulási use case a saját projektem, a
> **Plantbase** (NL→SQL agent a növény-katalógus felett). Ahol kódra hivatkozom, ott a repóbeli
> valódi fájlt jelölöm meg.

---

## 1. A kiindulási use case: Plantbase

A Plantbase egy magyar nyelvű, parancssori AI agent egy növény-webshop katalógusa felett. A
felhasználó természetes nyelven kérdez, például „mi a legolcsóbb kaktusz raktáron?", vagy „állíts
össze egy csomagot egy sötét nappaliba 30 ezerből". A célközönség elsősorban lakberendező,
másodsorban otthoni vásárló. Az agent a kérdésből SQL-t generál, read-only módon lefuttatja a
`products` táblán, majd a kapott sorokból rövid magyar választ ad. A második képessége a gondozási
tudás-kérdések kiszolgálása: a `searchKnowledge` tool RAG-pipeline-nal keres a tudásbázis-cikkekben,
és forráshivatkozásos, grounded választ ad. Ha nincs találat, azt kimondja, nem találgat.

A besorolás szempontjából három dolog számít.

- Milyen döntést hoz. Olyat nem, aminek emberre nézve jogkövetkezménye lenne. Terméket ajánl és
  csomagot állít össze egy vásárlási folyamatban, a vásárlásról pedig a felhasználó dönt.
- Milyen adatot kezel. A katalógus és a tudásbázis-cikkek nem személyes adatok. A felhasználó szabad
  szövegű kérdése viszont tartalmazhat személyes adatot, és ez a kérdés a RAG-pipeline-ban három külső
  szolgáltatóhoz is eljut: két amerikaihoz (Anthropic a nyelvi modellhez, OpenAI a beágyazáshoz) és egy
  európaihoz (a német Jina AI a találatok újrarangsorolásához), továbbá naplóba kerül. A szolgáltatók
  honossága a GDPR harmadik-országba-transzfer szempontjából nem mindegy, lásd a 3. pontot.
- Mi történik, ha téved. Rossz növényt ajánl, vagy hibás árat mond. A kár kereskedelmi, nem
  egészségügyi és nem alapjogi, visszafordíthatatlan következmény nincs.

A stack lényege: az agent-modell alapból `claude-sonnet-4-6` (Anthropic), a RAG-beágyazás
`text-embedding-3-small` (OpenAI), az újrarangsorolás pedig `jina-reranker-v2-base-multilingual`
(a német Jina AI). A `runSql` két rétegben védett, kód-szintű SELECT-guarddal
([run-sql.ts](../packages/core/src/lib/tools/run-sql.ts), `assertSelectOnly`) és külön read-only
DB-role-lal (`DATABASE_URL_READONLY`). Minden interakció JSONL-ként naplóba kerül
([logger.ts](../packages/core/src/lib/shared/logger.ts)): a system prompt, a teljes felhasználói
kérdés, a válasz, a token-használat, a generált SQL és a nyers eredménysorok.

---

## 2. AI Act besorolás, indoklással

### Kockázati szint: minimális, egy korlátozott (átláthatósági) réteggel

A Plantbase nem tartozik a tiltott gyakorlatok közé (Art. 5). Nem elemez érzelmet, embereket nem
pontoz, nem manipulál, és biometrikus kategorizálást sem végez.

Magas kockázatú sem, mert egyik Annex III-területbe sem esik. Végigmentem a nyolc területen
(biometria, kritikus infrastruktúra, oktatás, foglalkoztatás és HR, alapvető szolgáltatások mint a
credit scoring, bűnüldözés, migráció, igazságszolgáltatás): egy növény-webshop termékajánlója egyikbe
sem tartozik. Annex I-es termékbiztonsági beágyazás sincs, hiszen nem orvostechnikai eszköz, nem gép,
nem jármű, nem lift és nem játék.

Ami vonatkozik rá, az az **Art. 50 átláthatósági kötelezettség**. Generatív, emberrel társalgó
rendszerről (chatbotról) van szó, ezért közölni kell, hogy a felhasználó AI-val beszél, ha ez nem
nyilvánvaló. Ez a korlátozott, átláthatósági sáv, amely minden generatív AI-t használó rendszerre
igaz, nem csak a magas kockázatúakra. Emellett él az **Art. 4 AI-literacy** kötelezettség is, 2025.
február 2. óta, mindenkire: a Plantbaset üzemeltető és fejlesztő személyzetnek érdemi
AI-jártassággal kell rendelkeznie.

Összességében a rendszer érdemi része minimális kockázatú, egyetlen élő, konkrét kötelezettséggel
(Art. 50 közlési kötelezettség), plusz a mindenkire vonatkozó Art. 4 literacy-elvárással.

### Szerep a láncban: szolgáltató vagy üzembe helyező?

Aki agentic rendszert épít, az nem deployer, hanem provider (Art. 25).
A Plantbase ilyen rendszer. Alapmodell, rá épülő saját tool-készlet (`runSql`,
`listCategories`, `searchKnowledge`), orchestráció (a tool-use loop az
[ask-agent.ts](../packages/core/src/lib/agent/ask-agent.ts)-ben), RAG és saját promptok. Aki ezt
összerakja, és a saját vagy a webshop neve alatt kiadja, szolgáltatóvá (providerré) válik.

A gyakorlati felállás:

- A fejlesztő csapat (én) építi a rendszert. Ha a webshop a saját márkaneve alatt adja ki, a
  márkanevet rátevő webshop is providerré válhat (Art. 25(1)), miközben üzembe helyező is marad,
  hiszen ő futtatja élesben.
- A webshop mint üzemeltető a klasszikus üzembe helyező (deployer) szerep.

Minimális kockázatnál a nehéz provider-apparátus (Art. 8-15, konformitásértékelés, CE-jelölés) nem
aktiválódik, mert az kizárólag a magas kockázatú rendszerekre kötelező. A provider/deployer
megkülönböztetés itt tehát elsősorban felelősség-tisztázási kérdés, nem több tucat új kötelezettség.

A szerep akkor csúszna át egyikből a másikba, vagy a kötelezettség-szint akkor emelkedne, ha a
fejlesztő csapat egy már meglévő, magas kockázatú third-party rendszert jelentősen módosítana, vagy a
rendeltetést változtatná meg úgy, hogy magas kockázatúvá válik (Art. 25(1) b) és c) pont). Erről szól
a következő rész.

### Határeset-elemzés: mitől ugrana egy szinttel feljebb?

Több apró, de reális változtatás magas kockázatúvá tenné a Plantbaset.

1. **Fizetési döntés a pénztárnál.** Ha az agent kiegészülne egy „vásárolj most, fizess később" vagy
   részletfizetési ajánlattal, és bármilyen hitelképesség-jellegű megítélést végezne a vásárlóról, az
   már az Annex III 5(b) pontjába esik (credit scoring, hitelképesség értékelése), tehát magas
   kockázatú. Elég hozzá egyetlen új tool és egy scoring-prompt.

2. **Érzelemelemzés a chaten.** Ha a rendszer elemezné a vásárló hangulatát vagy elégedettségét a
   beszélgetésből (ügyfél-„szentiment"), az az Art. 50(3) közlési kötelezettségén túl érzékeny
   területre vezet. Munkavállalóra alkalmazva, például a call-center ügyintézőire, ez már Art. 5
   szerinti tiltott érzelemfelismerés lenne, a legmagasabb bírságsávval.

3. **Sérülékenység kihasználása.** A szándékosan manipulatív, dark-pattern jellegű rábeszélés,
   kifejezetten sérülékeny felhasználók (gyerekek, idősek) felé, Art. 5 szerinti tiltott gyakorlat
   lehet.

4. **Profilalkotás.** Ha a rendszer viselkedési profilt építene a vásárlókról, és ez alapján
   szegmentálná őket, a profilalkotás önmagában kizárja az Art. 6(3) mentességet, és közelíti a magas
   kockázatot ott, ahol Annex III-terület is felmerül.

A besorolás tehát a use case-hez tartozik, nem a modellhez. Ugyanaz a Claude-alapú agent minimális
kockázatú növény-ajánlóként, és magas kockázatú, ha hitelképességet érint.

---

## 3. Átfedő szabályozások

Az AI Acten kívül a következő szabályozások jönnek szóba, mindegyiknél indoklással, hogy miért, vagy
miért nem alkalmazandó.

### GDPR: valószínűleg igen, de szűk sávban

A katalógus és a tudásbázis nem személyes adat. A rendszer viszont két ponton mégis a GDPR hatálya alá
kerülhet.

- Szabad szövegű kérdés. A felhasználó bármit beírhat, és ha a telepítés a kérdést azonosítható
  felhasználóhoz köti (webshop-session, fiók, IP), onnantól személyes adatot kezel. A kérdés ráadásul
  több külső szolgáltatóhoz is kimegy: az Anthropichoz és az OpenAI-hoz (mindkettő amerikai), ami
  harmadik országba történő adattovábbítás, valamint az újrarangsoroláshoz a német Jina AI-hoz, amely
  viszont EU-honos. Erről a különbségről lentebb, a transzfer-résznél külön is szólok.
- Naplózás. A [logger.ts](../packages/core/src/lib/shared/logger.ts) a **teljes** felhasználói kérdést
  és a választ append-only JSONL-be írja, napi fájlokba, megőrzési szabály nélkül. Ez ütközik az
  adatminimalizálás (Art. 5(1)(c)) és a korlátozott tárolhatóság (Art. 5(1)(e)) elveivel, ha a napló
  személyes adatot tartalmazhat. Egy GDPR-audit ezt biztosan megkérdezné.

Konkrét teendő: az adatkezelés jogalapjának tisztázása, a naplók tárolási idejének korlátozása, és a
kérdés PII-szűrése (pszeudonimizálása), mielőtt providernek küldjük vagy naplózzuk.

**Egy reális bővítés hatása: hozzáférés a rendelési adatokhoz.** Ha az agent látná a vásárló rendelési
adatait (név, szállítási cím, rendeléstörténet, például a „mit vettem tavaly, ahhoz mit ajánlasz
mellé" típusú kérdésekhez), a GDPR-kép a fenti „valószínűleg igen, de szűk sávban" állapotból
egyértelmű, központi adatkezelésbe billen. Ez azonban adat-tengelyű változás, nem AI Act szintlépés: a
rendszer továbbra is növényt ajánl, tehát az AI Act besorolása marad minimális, mert a besorolást az
szabja meg, miről dönt a rendszer, nem az, milyen adatot lát. GDPR-oldalon a bővítés
a következőket tenné kötelezővé:

- Jogalap és célhoz kötöttség. A rendeléstörténet ajánlásra használata külön jogalapot és tisztázott
  célt kíván, és nem keverhető össze például a számlázási célú adatkezeléssel.
- Adatminimalizálás. Csak azok a mezők jussanak a modellhez, amelyek az ajánláshoz ténylegesen
  szükségesek, ne a teljes ügyfélprofil. A gyakorlatban ez gateway szinten szűrt, pszeudonimizált
  átadást jelent.
- Harmadik országba történő transzfer. Innentől nem csak a szabad szövegű kérdés, hanem strukturált
  személyes adat is kimenne az Anthropic és az OpenAI felé, ami élesíti a Chapter V és a CLOUD Act
  kérdését.

A rendelési adat hozzáférés tehát a GDPR-t teszi a legfontosabb megoldandó kérdéssé, nem az AI Act
szintet emeli. Szintet csak akkor mozdítana, ha az adatot döntéshez használnánk: profilalkotásra,
személyre szabott árazásra, hitelmegítélésre. Lásd a 2. pont határeset-elemzését.

### Harmadik országba történő adattovábbítás és a US CLOUD Act: igen

Az Anthropic és az OpenAI is amerikai cég, tehát a promptok elhagyják az EU-t. Ehhez GDPR Chapter V
szerinti mechanizmus kell: SCC-k, adatfeldolgozási szerződés, transfer impact assessment. A CLOUD Act
„possession, custody or control" tesztje miatt az EU-régió választása önmagában nem véd. Ha a
szolgáltató technikailag hozzáfér az adathoz, elvileg kötelezhető a kiadására. A Plantbase esetében a
tét kicsi, mert növény-kérdésekről van szó, de az elv ugyanaz, és amint a rendszer személyes vagy
üzletileg érzékeny adatot lát, éles kérdéssé válik. Kapcsolódik ehhez a data retention séma is: az API
és enterprise tier tipikusan 30 nap abuse-monitoring, amihez emberi reviewer is hozzáférhet, Zero Data
Retention pedig csak szerződéssel érhető el.

A rangsoroló Jina AI ezzel szemben német, tehát EU-honos cég, így a reranker-lépés vendorja önmagában
nem jelent harmadik országba történő adattovábbítást, és a US CLOUD Act sem terjed ki rá (egy német cég
nem US person). Ez a RAG-lánc egyetlen olyan külső lépése, amely GDPR-oldalról eleve kedvezőbb pozícióban
van. Két fenntartással viszont élni kell. Egyrészt a nyers, akár személyes adatot tartalmazó kérdést a
Jina is megkapja, ezért adatfeldolgozási szerződés (Art. 28) és a feldolgozói nyilvántartásba (Art. 30)
való felvétel rá is kell. Másrészt az EU-székhely önmagában nem garantálja a tényleges EU-n belüli
feldolgozást, ezért a konkrét feldolgozási régiót és az esetleges al-feldolgozókat (például amerikai
felhőinfra) le kell ellenőrizni, mielőtt a lépést valóban transzfer-mentesnek vesszük.

### Fogyasztóvédelem és e-kereskedelem: igen, ha B2C

Ha a webshop fogyasztóknak értékesít, a rendszer beleesik az általános fogyasztóvédelmi és a
tisztességtelen kereskedelmi gyakorlat elleni szabályok hatálya alá, tehát vonatkozik rá a dark
pattern tilalom és a félrevezető ajánlás tilalma is. Az agent nem árazhat és nem ajánlhat félrevezető
módon, és a döntést nem tolhatja manipulatívan. Ez nem AI-specifikus szabályozás, de a use case-hez
konkrétan kötődik, mert az agent kimenete közvetlenül befolyásolja a vásárlói döntést.

### DORA: nem

A DORA a pénzügyi szektor rendelete, a Plantbaset viszont egy növény-webshop üzemelteti, ami nem
pénzügyi szervezet, ezért a DORA nem alkalmazandó rá. (Ha bank vagy biztosító üzemeltetné a webshopot,
más lenne a kép: az LLM-provider mint ICT third party bekerülne a DORA-nyilvántartásba, kilépési
stratégiával együtt.)

### NIS2: jellemzően nem

A NIS2 az „alapvető" és „fontos" szervezetekre vonatkozik, és egy átlagos növény-webshop nem esik
bele, kivéve ha mérete vagy szektora alapján mégis, például mert nagy online piactér. Alapesetben
tehát nem alkalmazandó, de ezt a webshop méretével kell ellenőrizni.

### MDR / IVDR: nem

Nincs orvosi rendeltetés. A rendszer növényt ajánl, nem diagnosztizál, nem kezel és nem gyógyít, tehát
az orvostechnikai rendeletek nem érintik.

### Összefoglaló táblázat

| Szabályozás                     | Érinti?        | Miért                                                                                                         |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| AI Act (Art. 50 + Art. 4)       | Igen           | Generatív chatbot: közlési kötelezettség + AI-literacy                                                        |
| GDPR                            | Igen, szűken   | Szabad szövegű kérdés + megőrzési szabály nélküli napló + US-transzfer                                        |
| CLOUD Act / Chapter V transzfer | Igen           | Anthropic és OpenAI US-cégek, a prompt elhagyja az EU-t; a rangsoroló Jina viszont EU-honos, rá nem terjed ki |
| Fogyasztóvédelem / e-commerce   | Igen, ha B2C   | Az ajánlás közvetlenül befolyásolja a vásárlói döntést                                                        |
| DORA                            | Nem            | Nem pénzügyi szervezet üzemelteti                                                                             |
| NIS2                            | Jellemzően nem | Egy átlagos webshop nem „alapvető/fontos" szervezet                                                           |
| MDR / IVDR                      | Nem            | Nincs orvosi rendeltetés                                                                                      |

---

## 4. Email a jogi csapatnak

> Címzett: a Plantbaset üzemeltető webshop jogi / megfelelőségi csapata
> Tárgy: Plantbase AI-asszisztens, javasolt AI Act besorolás, megerősítést kérünk

Kedves Kollégák!

Az új Plantbase AI-asszisztens élesítése előtt szeretném tisztázni az AI Act szerinti besorolást, és
kérni a megerősítéseteket. Összefoglalom, amit ehhez tudni kell.

A rendszer egy magyar nyelvű asszisztens a webshop katalógusa felett. A vásárló természetes nyelven
kérdez, például hogy mi fér bele egy adott büdzsébe, vagy milyen növény való egy sötét szobába. Az
agent ezt adatbázis-lekérdezéssé fordítja, és ajánlást vagy csomagot állít össze. A második funkciója
növénygondozási kérdésekre válaszol a saját tudásbázisunkból, forráshivatkozással.

Használói elsősorban lakberendezők és otthoni vásárlók, a webshop felületén.

Az adatokról: a katalógus és a gondozási cikkek nem személyes adatok. A vásárló szabad szövegű kérdése
viszont tartalmazhat személyes adatot, és a kérdés feldolgozásához három külső szolgáltatót használunk:
kettő amerikai (egy a nyelvi modellhez, egy a beágyazáshoz), egy pedig európai, a német Jina AI a
találatok újrarangsorolásához. Utóbbi GDPR-szempontból kedvezőbb, mert EU-honos, de a jogalap és az
adatfeldolgozási szerződések tisztázása mindhárom szolgáltatóra vonatkozik. Emellett minden interakciót
naplózunk.

Az agent ajánl, nem dönt. A vásárlásról a felhasználó dönt. A rendszer nem végez hitelbírálatot,
embereket nem pontoz, és nem hoz olyan döntést, ami valakinek a jogaira vagy alapvető
szolgáltatásokhoz való hozzáférésére kihatna.

Ha téved, rossz növényt vagy hibás árat ajánlhat. A következmény kereskedelmi, nem egészségügyi és nem
alapjogi, és visszafordítható.

A javaslatunk: a rendszer **minimális kockázatú** az AI Act értelmében, mert egyik Annex III-területbe
sem esik, és nem tiltott gyakorlat. Mivel viszont generatív, emberrel társalgó chatbot, alkalmazandó
rá az **Art. 50 átláthatósági kötelezettség**, vagyis jelezni kell a felhasználónak, hogy AI-val
beszél. Emellett él az **Art. 4 AI-literacy** elvárás a csapatunkra. Ez a rendszert üzemeltető és
fejlesztő munkatársak érdemi AI-jártasságát írja elő: értsék, hogyan működik az eszköz és hol van a
korlátja, mit lehet rábízni és mit nem. 2025. február 2. óta hatályos, szolgáltatóra és üzembe
helyezőre egyaránt, és a gyakorlatban ez a leggyakrabban kihagyott kötelezettség, pedig belső
képzéssel gyorsan teljesíthető. A szerepekről: a rendszert építő csapat szolgáltatónak minősül, a
webshop üzembe helyezőnek, és ha a webshop a saját márkaneve alatt futtatja, akkor részben ő is
szolgáltatóvá válhat.

Amit kérnénk tőletek:

1. Erősítsétek meg, vagy pontosítsátok a minimális kockázat + Art. 50 besorolást.
2. Mondjátok meg, elég-e egy egyszerű AI-közlés a felületen az Art. 50-hez, és hova kerüljön.
3. Segítsetek a GDPR-oldal tisztázásában: mi a jogalap a napló és a US-transzfer kapcsán, és mennyi
   megőrzési időt javasoltok a naplókra.

Ha bármelyik ponton magasabb kockázatot láttok, jelezzétek, mielőtt élesítünk. Szívesen leülünk egy
rövid egyeztetésre is.

Köszönettel,
Várkonyi Róbert

---

## 5. A kapott use case elemzése: „QueueGenius" (fintech)

A választott brief a **QueueGenius**. Az agent nem hoz hiteldöntést, és a scoringhoz hozzá sem ér.
Annyit tesz, hogy beolvassa a beérkező hitelkérelmek dokumentumait, teljességi pontszámot ad (megvan-e
minden irat), és ez alapján sorba rendezi az ügyintézők munkalistáját. Az ügyintéző minden döntést maga
hoz. A rendszer egy amerikai SaaS-ra épül, a bank csak a promptokat és a szabályokat konfigurálja, és a
bank saját belső márkaneve alatt fut.

### 5.1 Saját elemzés

Ami a minimális vagy korlátozott kockázat mellett szól:

- Az agent nem pontoz hitelképességet, és nem érinti a scoringot.
- Csak a dokumentumok teljességét ellenőrzi, vagyis azt, hogy megvan-e minden irat, majd sorba rendez.
- Az ügyintéző minden érdemi döntést maga hoz.
- Egy Annex III-területbe eső rendszer mégsem magas
  kockázatú, ha nem jelent érdemi kockázatot az érintett jogaira, például mert csak szűk, eljárási
  (procedurális) feladatot lát el, vagy egy emberi tevékenységet készít elő anélkül, hogy érdemben
  befolyásolná a döntést. A teljességi checklist és sorbarendezés első ránézésre ilyen procedurális
  előkészítés.

Ami a magas kockázat mellett szól:

- A use case a hitelbírálati folyamat része. Az Annex III alapvető szolgáltatások pontja
  (hitelképesség értékelése, hitelhez való hozzáférés) tágan értelmezendő, tehát nem csak maga a
  scoring eshet bele, hanem az is, ami a hitelhez való hozzáférést befolyásolja.
- A sorbarendezés nem semleges. Ha az agent dönti el, kinek a kérelme kerül előre és kié „ragad be",
  akkor befolyásolja, ki jut előbb, vagy egyáltalán hitelhez. Egy „teljességi" pontszám, amely
  szisztematikusan hátrébb sorolja bizonyos ügyfelek kérelmét, például azoké, akiknek nehezebb minden
  iratot beszerezni, közvetett hátrányos megkülönböztetést okozhat. Pontosan az a fajta érdemi hatás,
  amit az Art. 6(3) mentesség kizár.
- Az Art. 6(3)-nak van egy kemény kizárása is: a profilalkotás. Ha a teljességi pontszám vagy a
  sorbarendezés természetes személyek profilozásán alapul, a mentesség nem alkalmazható, és a rendszer
  magas kockázatú marad.

A szerepkérdés:

- A bank a rendszert a saját belső márkaneve alatt futtatja. Ettől az Art. 25(1)(a) szerint
  szolgáltatóvá (providerré) válik, nem marad puszta üzembe helyező, akkor sem, ha „csak a promptokat
  konfigurálja".
- A bank ezen túl promptokkal és szabályokkal konfigurálja a rendszert egy amerikai SaaS tetején. Majdnem
  biztosan providerré teszi, ha a rendszer magas kockázatú.
- Az amerikai SaaS a mögöttes külső komponens. Ha a bank pénzügyi szervezet (márpedig az), akkor
  ez a SaaS egyben DORA szerinti ICT third-party service provider is, nyilvántartással, szerződéses
  minimumokkal, kilépési stratégiával.

Hová sorolnám, és milyen feltételekkel: alapértelmezésben magas kockázatúként kezelném, és a
bizonyítási terhet megfordítanám: csak akkor mennék le korlátozott vagy minimális szintre, ha az Art.
6(3) mentesség feltételei bizonyíthatóan és dokumentáltan teljesülnek. Konkrétan akkor maradhat kívül a
magas kockázaton, ha

1. a teljességi pontszám tisztán mechanikus (megvan-e az irat: igen/nem), és nem tartalmaz semmilyen
   ügyfél-profilozást vagy minőségi megítélést,
2. a sorbarendezés nem befolyásolja érdemben, ki jut hitelhez (például minden kérelmet ugyanabban a
   határidőben feldolgoznak, a sorrend csak a napon belüli munkaszervezést érinti, a kimenetet nem),
3. és mindezt méréssel is igazolják

Ha ezek közül bármelyik nem áll, akkor magas kockázatú, a bank pedig szolgáltató. Óvatosságból az
utóbbit feltételezném a tervezésnél, mert a lefelé sorolás jogi hibája sokkal drágább (Art. 5 és
high-risk bírságsávok), mint a felesleges körültekintés.

### 5.2 LLM-teszt

Modell: Claude Opus 4.8 (claude-opus-4-8), 2026. augusztusi futtatás.

A pontos prompt, a briefet szó szerint átadva:

```
Az alábbi use case-t sorold be az EU AI Act szerint. Add meg a kockázati szintet, a hivatkozott
cikket vagy Annex III pontot, és a szereplők szerepét (szolgáltató / üzembe helyező). Röviden indokolj.

QueueGenius: Az agent nem hoz hiteldöntést, hozzá sem ér a scoringhoz. Csak beolvassa a beérkező
hitelkérelmek dokumentumait, teljességi pontszámot ad (megvan-e minden irat), és ez alapján okosan
sorba rendezi az ügyintézők munkalistáját, hogy a „gördülékeny" ügyek ne ragadjanak be. Az ügyintéző
minden döntést maga hoz. A rendszer egy amerikai SaaS-ra épül, mi csak a promptokat és a szabályokat
konfiguráljuk, és a bank saját belső márkaneve alatt fut.
```

Az LLM válasza, rövidítve, de tartalmilag híven:

> Besorolás: valószínűleg **korlátozott/minimális kockázat**, de határeset. A rendszer a hitelbírálat
> környékén működik (Annex III, alapvető szolgáltatások, hitelképesség), viszont nem végez scoringot
> és nem hoz döntést, csak dokumentum-teljességet ellenőriz és sorba rendez. Az Art. 6(3) alapján egy
> tisztán procedurális, előkészítő feladat kieshet a magas kockázatból. Szerep: a bank üzembe
> helyező, az amerikai SaaS a szolgáltató. Javaslat: dokumentálni kell, hogy a rendszer valóban nem
> befolyásolja a hiteldöntést.

Összevetés a saját elemzésemmel, a dokumentált eltérésekkel:

| Szempont             | LLM (Opus 4.8)                            | Saját elemzés                                                                                    |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Kiindulási besorolás | Korlátozott/minimális, határesetként      | Alapból magas kockázat, amíg a mentesség nincs bizonyítva                                        |
| Art. 6(3)            | Megemlíti mentségként                     | Megemlítem, **de** kiemelem a profilalkotási kizárást és a „ki jut előbb hitelhez" érdemi hatást |
| Sorrendezés hatása   | Semlegesnek veszi                         | Nem semleges: befolyásolhatja a hitelhez jutást, közvetett diszkrimináció kockázata              |
| Szerep               | Bank = üzembe helyező, SaaS = szolgáltató | Bank = **szolgáltató** is, mert a **saját márkaneve alatt** futtatja (Art. 25(1)(a))             |
| DORA                 | Nem említi                                | Kiemelem: a SaaS egyben DORA ICT third party                                                     |

Az eltérésekből az látszik, hogy az LLM a felszíni megfogalmazást („nem dönt, csak sorba rendez", „mi
csak a promptokat konfiguráljuk") túlságosan névértéken vette, és emiatt túl enyhén sorolt be. Két
dolgot hagyott ki, mindkettő fontos: a márkanév miatti provider-szerepet, ami ott van a briefben, csak
nem hangsúlyos, illetve azt, hogy a sorrendezés érdemi hatás lehet a hitelhez jutásra, ami épp az Art.
6(3) mentesség ellen szól.

---

## 6. Válasz a jogi csapatnak: teendők és mérések

Kedves Anna!

Köszönjük a besorolást és a listát. Kötelezettségenként összeszedtem, mit építünk meg (ebből lesz a
fejlesztői jegy) és mivel igazoljuk auditkor (a mérőszám).

Két elv fut végig mindenen: **legszűkebb jogosultság** (az asszisztens csak a feltétlenül szükséges
műveletet és adatot kapja) és **teljes visszakövethetőség** (minden lépés naplózva). Fontos: az
utasítás-szöveg („rendszerprompt") nem biztonsági korlát — a kemény korlátokat (pl. összeghatár) a
kódba építjük, nem a promptba, mert csak a kód nem megkerülhető.

### Art. 9 — Kockázatkezelési rendszer (a teljes életciklusra)

**Intézkedés:** kockázati nyilvántartás felelőssel és határidővel; élesítés előtti fenyegetés-modell
(OWASP LLM/Agentic Top 10, kiemelten a rejtett utasítás a bejövő szövegben, a túl sok jogosultság és az
ellenőrizetlen kimenet) és betöréses teszt (Garak, Promptfoo); vészleállító kapcsoló; kiadás előtti
jóváhagyó kapu; a tartalék-modell/régió ugyanúgy minősítve, hogy adat ne szökjön más joghatóságba.

**Mérés:** lezárt kockázatok aránya; támadásteszt-jegyzőkönyv (mennyi támadás jutott át); mitigációval
fedett kockázatok aránya; élesítés utáni incidensszám.

### Art. 10 — Adatkezelés és adatminőség (adat-governance)

**Intézkedés:** adat-útvonal dokumentálva; a modell csak a panaszhoz szükséges mezőket kapja (szűrő a
modell előtt); személyes adat álnevesítése, a válaszban visszaírva (magyar azonosítókra is: TAJ,
adóazonosító, IBAN); hozzáférés-szabályozás a szűrő elé. Az álnevesített adat is személyes adat, és a
szűrő nem lehet az egyetlen védelem.

**Mérés:** a szűrő találati pontossága magyar teszthalmazon (reálisan ~60%-ról indul, ezért kell réteges
védelem); álnevesített kérdések aránya; a modellhez ténylegesen eljutott mezők ellenőrzése.

### Art. 12 — Naplózás és eseményrögzítés

**Intézkedés:** kérésenként teljes nyomvonal közös azonosítóval (nem soronkénti napló): kérdés/válasz,
modell+verzió, költség, minden adat-lekérdezés be-/kimenettel, felhasználó, korlátok életbe lépése,
újrapróbák. Saját üzemeltetésű naplózó (nem külső felhő); megőrzés legalább 6 hónap, módosíthatatlanul.

**Mérés:** teljes nyomvonallal bíró kérések aránya (~100%); kötelező mezők megléte; megőrzési idő
betartása; napló-hozzáférés naplózva; incidens rekonstrukciós ideje.

### Art. 14 — Emberi felügyelet

**Intézkedés:** az asszisztens csak előkészít, nem küld és nem dönt; a javaslat mellett ott a forrás
(mely tranzakció, szerződéspont); aktív emberi jóváhagyás kötelező, felülírható és naplózott.

**Mérés:** eszkalációs és felülírási arány; módosítás nélkül elfogadott javaslatok aránya — ha túl
magas, gépies jóváhagyás, a felügyelet valójában nem működik; átlagos ellenőrzési idő.

### Art. 15 — Pontosság, ellenállóképesség, kiberbiztonság

**Intézkedés:** referencia teszt-készlet, minden modell-/prompt-változás után újrafuttatva; forrás
nélkül „nincs információ" (nincs kitalálás); adathoz csak olvasási jog; a panasz szövege adat, nem
utasítás; kérés-sebesség korlát; pénzösszegre kódba épített kemény korlát.

**Mérés:** pontosság a teszt-készleten (időbeli trenddel); feladat-sikeresség és hibaarány; kitalált
válaszok aránya; ellenállás a rejtett-utasításos támadásnak; a megengedett sávon belüli
összeg-javaslatok aránya (cél: 100%).

### Art. 26 — Üzembe helyezői kötelezettségek

**Intézkedés:** a szolgáltató utasításai szerinti használat; képzett emberi felügyelet; bemeneti adat
ellenőrzése; működés-figyelés és incidensjelentés (Art. 73); napló legalább 6 hónap; az ügyintézők és
az érintett ügyfelek tájékoztatása; hatósági együttműködés.

**Mérés:** felügyelők létszáma és képzési nyilvántartása; bemeneti ellenőrzés átmenési aránya;
incidensjelentési határidők betartása; megőrzés bizonyítéka; ügyfél-tájékoztatás lefedettsége.

### Art. 27 — Alapjogi hatásvizsgálat (FRIA)

**Intézkedés:** FRIA üzembe helyezőként (folyamat, érintettek, jogi kockázatok, mitigáció, felügyelet,
jogorvoslat), a GDPR DPIA-val összehangolva; torzítás-vizsgálat a kártérítési javaslatokra.

**Mérés:** FRIA elkészült és keltezett; torzítás-mutatók a védett csoportok között; jogorvoslat
használata és ideje; DPIA–FRIA közös lefedettség.

### Szerepek és zárás

Mivel a fejlesztő csapat részben szolgáltató, és a bank a saját neve alatt futtatva szintén
szolgáltatóvá válhat, a szerepmegosztást a szerződésben rögzítjük. Ha a rendszer átlépi a szolgáltatói
küszöböt (Art. 25), a szolgáltatói oldalon az Art. 8–15 és a megfelelőségértékelés is a képbe kerül.

Minden fenti pont egy-egy backlog-tétel nálunk, mérőszámmal. Szívesen leülünk egy rövid workshopra,
ahol pontról pontra átvesszük.

Üdvözlettel,
Várkonyi Róbert
