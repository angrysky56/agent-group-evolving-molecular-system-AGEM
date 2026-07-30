#!/usr/bin/env bash
# TypeDB 3.x commit probe for the finding revalidation ledger.
set -uo pipefail
DB="${1:-agem-claims}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ADDRESS="${TYPEDB_CONSOLE_ADDRESS:-127.0.0.1:1729}"
USERNAME="${TYPEDB_USERNAME:-admin}"
PASSWORD="${TYPEDB_PASSWORD:-password}"
TDB=(typedb console --address "$ADDRESS" --tls-disabled --username "$USERNAME" --password "$PASSWORD")

cat > "$TMP/finding.tql" <<'EOF'
insert
  $f isa finding,
    has finding-id "revalidation-probe",
    has verdict "No model satisfies the complete joint constraint.",
    has coverage "All source-grounded claims checked.",
    has run-log-id "probe-run",
    has produced-by-model "probe",
    has method "derived-from-claims",
    has finding-outcome "contradiction",
    has memory-namespace "probe",
    has semantic-verdict-kind "corpus-contradiction",
    has attribution-validated true,
    has semantics-validated true,
    has finding-status "active",
    has verification-fingerprint "fingerprint-v1",
    has created-at 2026-07-30T00:00:00.000-06:00,
    has corpus-id "ToM";

EOF

out=$("${TDB[@]}" --command "transaction write $DB" --command "source $TMP/finding.tql" --command "commit" 2>&1)
if ! echo "$out" | grep -qi "Successfully committed"; then
  echo "Finding seed failed"
  echo "$out" | head -20
  exit 1
fi

cat > "$TMP/revalidate.tql" <<'EOF'
match
  $f isa finding, has finding-id "revalidation-probe";
update
  $f has finding-status "revalidation-required";
insert
  $f has revalidation-required-at 2026-07-30T00:01:00.000-06:00,
    has revalidation-changes "[{\"dependency\":\"formalizerVersion\"}]";

EOF

out=$("${TDB[@]}" --command "transaction write $DB" --command "source $TMP/revalidate.tql" --command "commit" 2>&1)
if ! echo "$out" | grep -qi "Successfully committed"; then
  echo "Finding revalidation update failed"
  echo "$out" | head -20
  exit 1
fi

echo "FINDING REVALIDATION CONTRACT PASSED"
