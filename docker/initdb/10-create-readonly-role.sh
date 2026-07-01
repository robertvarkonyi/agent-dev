#!/bin/bash
# Read-only role létrehozása a katalógus fölé (az agent runSql-je ezen fut).
# Csak az első inicializáláskor fut (üres data dir). A jelszó a .env-ből (POSTGRES_RO_PASSWORD).
# A tábla(k) még nem léteznek itt; a DEFAULT PRIVILEGES gondoskodik róla, hogy a később
# (Prisma migrációval, a POSTGRES_USER által) létrehozott táblákra is legyen SELECT jog.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE ROLE "$POSTGRES_RO_USER" WITH LOGIN PASSWORD '$POSTGRES_RO_PASSWORD';
	GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO "$POSTGRES_RO_USER";
	GRANT USAGE ON SCHEMA public TO "$POSTGRES_RO_USER";
	GRANT SELECT ON ALL TABLES IN SCHEMA public TO "$POSTGRES_RO_USER";
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "$POSTGRES_RO_USER";
SQL

echo "read-only role '$POSTGRES_RO_USER' created (SELECT-only)"
