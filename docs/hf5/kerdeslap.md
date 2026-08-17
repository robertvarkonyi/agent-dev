# Plantbase Ügyfélsegéd — kérdéslap (felkészülés a kötekedőkre)

> A hat kapott kérdés + két saját, kényes kérdés. Minden válasz a **saját PoC-ra** mutat
> (fájlok, tényleges viselkedés), nem általánosságokra.

## A hat kapott kérdés

### 1. Milyen személyes adat kerül a rendszerbe, és melyik pontján tűnik el vagy anonimizálódik?

A rendszer alapadatai — a katalógus (`products`) és a gondozási tudásbázis — **nem személyes
adatok**. Személyes adat egyetlen ponton kerülhet be: a vásárló **szabad szövegű kérdésében**, ha
véletlenül beleír ilyet (pl. nevet, címet, telefonszámot). Őszintén: a PoC **ma nem szűri és nem
anonimizálja** ezt a szöveget, mielőtt a providerekhez küldi vagy naplózza — ez a legfontosabb
GDPR-teendő a pilot előtt. A rendszer **strukturált** személyes adatot (rendelés, számla, CRM)
egyáltalán nem lát, mert nincs bekötve — a rendelés-státusz kérdést épp ezért irányítja emberhez
(4. fájdalom, kimondottan nem megoldott). A célállapot: **PII-szűrés/pszeudonimizálás egy gateway
szinten**, még a provider-hívás és a naplózás előtt — ez az 1. számú pilot-feladat.

### 2. Hol fut a modell, hova utazik az adat, és mi az, ami sosem hagyja el a saját környezetünket?

A modellek külső API-kon futnak: **Anthropic (USA)** az agent-modell, a HyDE és a válasz;
**OpenAI (USA)** a beágyazás; **Jina AI (EU, Németország)** az újrarangsorolás. A vásárló kérdése
(és a katalógus-/cikk-részletek a promptban) ezekhez eljut — a két amerikai vendor felé ez GDPR
Chapter V szerinti harmadik-országba-transzfer (SCC + DPA kell), a Jina EU-honos, ezért
kedvezőbb. **Sosem hagyja el a környezetünket:** a katalógus és a tudásbázis (lokális Postgres), a
**read-write** DB-kapcsolat, a DB-jelszavak, és más vásárlók adatai. Kulcs-invariáns: az agent
kizárólag **read-only SELECT** kapcsolaton dolgozik (kód-guard: `assertSelectOnly` a
[run-sql.ts](../../packages/core/src/lib/tools/run-sql.ts)-ben, plusz külön read-only DB-role) — a
teljes adattérkép a prezentáció 4. diáján.

### 3. Melyik lépésnél hagy jóvá ember, mit lát a döntés előtt, és mit tud visszavonni utána?

A **jóváhagyási pont az eszkaláció**: amikor az agent bizonytalan vagy hatókörön kívüli a kérés,
`escalateToHuman`-nal jegyet ír, és a session **operátor-nézetre vált**
([handleHandoff a main.ts-ben](../../apps/cli/src/main.ts)). A kolléga a döntés előtt **a teljes
kontextust látja**: a vásárló kérdését, az eszkaláció okát, az AI összefoglalóját és hogy mely
tool-okat próbálta. Három döntése van: **jóváhagy+átvesz** (`approved`), **elutasít** (`rejected`)
vagy **saját választ ír** (`answered`). Az **elutasítás a visszavonás**: az eszkalációt
érvényteleníti, a kérdést visszaadja az AI-nak. Minden döntés `resolved` eseményként a jegysorba
kerül (audit), és a `pnpm cli sor` visszaolvassa.

### 4. Mi kerül naplóba, ki fér hozzá, és mennyi ideig marad meg?

Két append-only napló van. Az **agent-napló** (`logs/*.jsonl`,
[logger.ts](../../packages/core/src/lib/shared/logger.ts)) kérdésenként rögzíti a **teljes**
kérdést, a választ, a generált SQL-t, az eredménysorokat, a modellt és a token-felhasználást — az
eszkaláció is (`escalateToHuman:<reason>`). A **jegysor** (`tickets/*.jsonl`) a vásárlói üzenetet, az
összefoglalót és a kolléga döntését. Ma mindkettő **lokális fájl**, a repóból kizárva
(`.gitignore` — nem verziózzuk, mert PII-t tartalmazhat). Őszintén: **ma nincs megőrzési szabály** —
ez GDPR-oldalon hiányosság (adatminimalizálás + korlátozott tárolhatóság). Teendő a pilotra:
korlátozott megőrzési idő, hozzáférés-szabályozás + hozzáférés-naplózás, és a napló **PII-szűrése**.

### 5. Mi történik, ha az agent téved, és mennyi idő alatt állítható vissza az előző állapot?

A tévedés legrosszabb esete egy **rossz növény-ajánlás vagy hibás ár** — a kár **kereskedelmi,
visszafordítható**, nem egészségügyi és nem alapjogi. „Előző állapot visszaállítása" itt szinte
tárgytalan, mert az agent **adatot nem módosít** (read-only SELECT; a katalógusba nem ír). Az
egyetlen írás az append-only napló és jegysor — ezek auditálhatók, és egy tévedés
**korrekció hozzáfűzésével** javítható, nem kell rollback. A tévesen eszkalált jegy azonnal
visszavonható (`rejected`). A forrás nélkül kiment válasz veszélyét a groundolás (grounded=false →
eszkaláció) és a napló-audit (mérési terv 5. metrika) fogja meg. Egy elrontott prompt/tool változást
git-revert + újraindítás állít vissza — nincs perzisztens rossz állapot, amit „vissza kellene
tekerni".

### 6. Ki lesz a rendszer gazdája a bevezetés után, és miből fogja látni, hogy jól működik?

A gazda az **ügyfélszolgálati csapat vezetője** (folyamatgazda): ő futtatja/nézi a heti és havi
mérőszámokat, és a `pnpm cli sor` jegysor-nézetet. „Jól működik" jelei a
[mérési tervből](meresi-terv.md): magas **önkiszolgálási arány** (2. fájdalom), rövid
**válaszidő** (1. fájdalom), a **sávban lévő eszkalációs arány** (8. fájdalom), és a két
**hiba-metrika** alacsonyan tartva (forrás nélküli válasz, túl-eszkaláció). A prompt/eszköz-
változásokhoz fejlesztői support marad a háttérben.

## Két saját, kényes kérdés (amitől a legjobban tartanék)

### Saját 1. — A confidence gate a promptban van. Mi garantálja, hogy az agent tényleg eszkalál, és nem talál ki mégis egy választ egy hatókörön kívüli kérdésre — pláne, ha valaki szándékosan „jailbreakeli"?

Ez a rendszer leggyengébb pontja, és nem szépítem: **semmi nem garantálja hard módon a routingot.**
A confidence gate az `CUSTOMER_SYSTEM_PROMPT` szövegében él, a prompt pedig **nem biztonsági
határ** — az LLM követheti rosszul, és egy célzott prompt-injection ki is billentheti. **Kemény
garancia csak a read-only SQL-re van** (kód-guard + DB-role): az agent adatot semmiképp nem
módosít, akkor sem, ha „ráveszik". A routingra rétegzett, best-effort védelem van:
a **groundolás** (a `searchKnowledge` `grounded=false`-t ad, ha nincs fedő forrás, és a prompt ekkor
eszkalációt ír elő), a **teljes naplózás** (minden válasz auditálható), az **emberi handoff** az
eszkalált eseteken, és a **mérés** (a „forrás nélkül kiment válasz" metrika épp ezt a hibát méri).
Pontosan ezért **pilotálunk emberi felügyelettel**, és a hiba-metrikát figyeljük, mielőtt jobban
megbíznánk benne — nem a prompt szövegében bízunk, hanem a köré épített monitoringban és a read-only
kényszerben.

### Saját 2. — Mire az agent eldönti, hogy egy hatókörön kívüli kérdést eszkalál, a nyers vásárlói üzenet (a benne lévő PII-vel) MÁR elment Anthropichoz (USA). Akkor az emberi handoff nem is véd a transzfer ellen — igaz?

De, igaz — és ez fontos, önként kimondott korlát. Az eszkaláció a **válasz minőségét** védi (nincs
kitalált válasz), **nem az adattranszfert**. Ahhoz, hogy az agent egyáltalán eldöntse, hogy
eszkalálnia kell, a modellnek **el kell olvasnia** a kérdést — vagyis a nyers üzenet a döntés előtt
már eljut az amerikai providerhez. Az emberi kapu ezen nem változtat; a transzfer a 2. lépésnél
történik, nem a jóváhagyásnál. A valódi megoldás **upstream** van, nem a handoffban: **PII-szűrés/
pszeudonimizálás a provider-hívás ELŐTT** (a legfontosabb GDPR pilot-feladat), SCC + DPA az
amerikai vendorokkal, és ahol lehet, az EU-honos vendor (Jina) előnyben részesítése. Amíg a
PII-szűrés nincs élesben, az őszinte scope az, hogy **a szabad szöveges mezőn ne menjen át valódi
PII**, és erre a felületen figyelmeztetünk. Ezt a korlátot a human-in-the-loop **nem** oldja meg — a
prezentációban sem állítjuk, hogy megoldaná.
