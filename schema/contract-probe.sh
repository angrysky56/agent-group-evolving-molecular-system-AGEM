#!/usr/bin/env bash
# Does the schema actually REJECT the extraction failure it was built to catch?
#
# The Test C failure: a formalizer read the IIT/GWT sections, dropped the
# exclusion ("Φ-systems do not broadcast"), emitted two compatible conditionals,
# and reported "CONSISTENT" with confidence. Nothing could catch it.
#
# A schema is only a contract if malformed writes FAIL. This probe checks that.
# Queries go through `source <file>` — the console's --command takes console
# commands, not raw TypeQL, so inline queries fail on argument parsing and look
# like schema rejections when they are nothing of the kind.
set -uo pipefail
DB="${1:-agem-claims}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ADDRESS="${TYPEDB_CONSOLE_ADDRESS:-127.0.0.1:1729}"
USERNAME="${TYPEDB_USERNAME:-admin}"
PASSWORD="${TYPEDB_PASSWORD:-password}"
TDB=(typedb console --address "$ADDRESS" --tls-disabled --username "$USERNAME" --password "$PASSWORD")
failures=0

run() { # run <label> <expectation> <query-text>
  printf '%s\n' "$3" > "$TMP/q.tql"
  echo "──── $1"
  echo "     expect: $2"
  out=$("${TDB[@]}" --command "transaction write $DB" --command "source $TMP/q.tql" --command "commit" 2>&1)
  if echo "$out" | grep -qi "Successfully committed"; then
    actual="ACCEPTED"
  else
    actual="REJECTED"
  fi
  echo "     RESULT: $actual"
  if [ "$actual" != "$2" ]; then
    echo "     CONTRACT FAILURE: expected $2, got $actual"
    failures=$((failures + 1))
  fi
  if [ "$actual" = "REJECTED" ]; then
    echo "$out" | grep -oiE "\[[A-Z]{3}[0-9]+\][^\\\\]{0,110}" | head -2 | sed 's/^/       /'
  fi
}

# Seed concepts and the source sentence.
cat > "$TMP/seed.tql" <<'EOF'
insert
  $s isa segment, has segment-id "tom-3-1", has corpus-id "ToM",
     has text "One says consciousness is intrinsic integration whether or not anything is broadcast; the other says consciousness is broadcast availability.";
  $phi isa concept, has label "phi";
  $bc isa concept, has label "broadcast";
  $cs isa concept, has label "consciousness";
EOF
seed_out=$("${TDB[@]}" --command "transaction write $DB" --command "source $TMP/seed.tql" --command "commit" 2>&1)
if ! echo "$seed_out" | grep -qi "Successfully committed"; then
  echo "Seed write failed; the contract probe did not run."
  echo "$seed_out" | head -20
  exit 1
fi

run "well-formed exclusion (Φ excludes broadcast)" "ACCEPTED" '
match
  $phi isa concept, has label "phi";
  $bc isa concept, has label "broadcast";
  $s isa segment, has segment-id "tom-3-1";
insert
  $_ isa exclusion, links (excluder: $phi, excluded: $bc, source: $s);'

run "exclusion missing the excluded role — THE TEST C FAILURE" "REJECTED" '
match
  $phi isa concept, has label "phi";
  $s isa segment, has segment-id "tom-3-1";
insert
  $_ isa exclusion, links (excluder: $phi, source: $s);'

run "claim with no provenance (source omitted)" "REJECTED" '
match
  $phi isa concept, has label "phi";
  $bc isa concept, has label "broadcast";
insert
  $_ isa exclusion, links (excluder: $phi, excluded: $bc);'

run "causal-claim with no polarity — epiphenomenalism/interactionism collapse" "REJECTED" '
match
  $cs isa concept, has label "consciousness";
  $bc isa concept, has label "broadcast";
  $s isa segment, has segment-id "tom-3-1";
insert
  $_ isa causal-claim, links (cause: $cs, effect: $bc, source: $s);'

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "$failures CONTRACT FAILURE(S)"
  exit 1
fi
echo ""
echo "ALL CONTRACT EXPECTATIONS PASSED"
