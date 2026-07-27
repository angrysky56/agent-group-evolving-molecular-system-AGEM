#!/usr/bin/env bash
# Dump the live schema of the AGEM claim database.
#
# Exists because a schema-define failure reports only the ONE attribute that
# collided, not what the database already holds — and the fix depends entirely
# on which definition is already in place. Guessing produced a redefine that
# would have silently changed the stored value type.
set -euo pipefail

ADDR="${TYPEDB_ADDRESS:-http://127.0.0.1:8100}"
DB="${TYPEDB_DATABASE:-agem-claims}"
USER="${TYPEDB_USERNAME:-admin}"
PASS="${TYPEDB_PASSWORD:-password}"

TOKEN=$(curl -sS -m 5 -X POST "$ADDR/v1/signin" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')

if [ -z "$TOKEN" ]; then
  echo "Could not authenticate to $ADDR" >&2
  exit 1
fi

echo "== databases =="
curl -sS -m 10 "$ADDR/v1/databases" -H "Authorization: Bearer $TOKEN" |
  python3 -m json.tool

echo
echo "== schema of $DB =="
curl -sS -m 20 "$ADDR/v1/databases/$DB/schema" -H "Authorization: Bearer $TOKEN"
