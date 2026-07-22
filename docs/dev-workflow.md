# Plantbase — fejlesztői workflow + automatizmus

> Kurzus-melléklet. Konkrét git-szabályok, hook-konfigurációk, dokumentációs folyamat. L1 (amivel építünk): ezt is átadjuk a Claude Code-nak.

## Git

### Branching

- `main`: mindig zöld, deploy-olható. Közvetlenül main-re NEM commitolunk.
- Feature branch: `feat/<rövid-leírás>` (pl. `feat/runsql-tool`). Egyéb prefixek: `fix/`, `refactor/`, `docs/`, `chore/`.
- A kurzus checkpointjai (`stage-N`) branchek a fallbackhez.

### Commit (Conventional Commits)

Formátum: `<típus>: <leírás>`. Típusok: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.
Példák: `feat: add read-only runSql tool`, `test: cover runSql SELECT-only guard`.

### Auto-commit

Minden befejezett, koherens lépés után kicsi, fókuszált commit (egy lépés = egy commit). Lásd a `Stop` hookot.

## Hookok (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/format.sh\"",
            "timeout": 10000,
            "async": true
          },
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/test-related.sh\"",
            "timeout": 60000,
            "async": true
          }
        ]
      }
    ]
  }
}
```

- **prettier** ([.claude/hooks/format.sh](../.claude/hooks/format.sh)): formázás szerkesztés után.
- **teszt** ([.claude/hooks/test-related.sh](../.claude/hooks/test-related.sh)): a változáshoz tartozó Vitest (`vitest related`) fut.

A szerkesztett fájl útját a hookok a payload **stdin JSON `tool_input.file_path`**
mezőjéből olvassák — a Claude Code nem expandál `$FILE`-t, ezért kis wrapper
scriptek kapják el a fájlt (támogatott kiterjesztésekre szűrve, fail-soft: a hook
sosem blokkolja a szerkesztést). A `matcher` `Edit|Write`, hogy az új fájlok
(`Write`) is formázódjanak/teszteljenek.

FONTOS: a hookok a **Claude Code (L1) akcióit** fogják meg (amit Claude szerkeszt/futtat), NEM a termék futásidejű SQL-jét. A termék read-only védelme a **DB-kapcsolat (read-only role)**, nem hook, mert a `runSql` a termék kódja, nem Claude Code tool.

## /docs (a repóban)

```
docs/
├── ddd/
│   ├── glossary.md        ubiquitous language (növény, kategória, fényigény, gondozás...)
│   └── model.md           entitások, value objectek, aggregátumok
└── tech/
    ├── infra.md           Postgres (OrbStack docker-compose), .env, a két DB-kapcsolat
    ├── architecture.md    core/apps, adat-elérés, read-only vs Prisma
    └── api.md             tool/CLI felület (ask, runSql)
```

## Dokumentáció-frissítés

A `/docs` frissítését a **`ddd-audit` skill** végzi (git-history → docs), külön, igény szerint futtatva. NEM készítünk doc-freshness ellenőrző scriptet és Stop hookot az elején. A CI-alapú változat a 4. órán jön (always-on / CI/CD).
