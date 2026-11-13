#!/usr/bin/env bash
# Conformance gate (plan PR5): HL7 validator_cli against the golden fixtures.
#   positives (tests/fixtures/golden)          must have zero error issues
#   negatives (tests/fixtures/golden-negative) must each have at least one error
# The jar is cached outside the repo and pinned by sha256; a mismatch aborts.
# Needs Java 17+, Node, and network access to tx.fhir.org and packages2.fhir.org.
set -euo pipefail

VERSION=7.0.5
SHA256=9dfe9f305b0f9389eceade2a4a1c9a2740d7b0e614066fdf07a78b571c76d92f
URL="https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${VERSION}/validator_cli.jar"
CACHE="${VALIDATOR_CACHE:-$HOME/.cache/chartinghero}"
JAR="$CACHE/validator_cli-$VERSION.jar"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMMARY="$ROOT/scripts/validation-summary.mjs"

mkdir -p "$CACHE"
if [[ ! -f "$JAR" ]]; then
  echo "downloading validator_cli $VERSION"
  curl -fsSL --retry 3 -o "$JAR.part" "$URL"
  mv "$JAR.part" "$JAR"
fi
echo "$SHA256  $JAR" | sha256sum -c --quiet - || { echo "validator jar sha256 mismatch: $JAR" >&2; exit 1; }

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

run() { # <outcome.json> <files...>
  local out="$1"; shift
  # With -output the jar exits 0 whatever it finds; the summary script is the gate.
  java -jar "$JAR" -version 4.0.1 -ig hl7.fhir.us.core#9.0.0 "$@" -output "$out" > "$out.log" 2>&1 \
    || { cat "$out.log" >&2; echo "validator crashed" >&2; return 1; }
  [[ -s "$out" ]] || { cat "$out.log" >&2; echo "validator wrote no output" >&2; return 1; }
}

shopt -s nullglob
POS=("$ROOT"/tests/fixtures/golden/*.json)
NEG=("$ROOT"/tests/fixtures/golden-negative/*.json)
(( ${#POS[@]} > 0 )) || { echo "no positive fixtures; run npm run golden" >&2; exit 1; }
(( ${#NEG[@]} > 0 )) || { echo "no negative fixtures; run npm run golden" >&2; exit 1; }

status=0
echo "== positives (expect 0 errors): ${#POS[@]} files"
run "$OUT/pos.json" "${POS[@]}"
node "$SUMMARY" "$OUT/pos.json" --expect pass || status=1

echo "== negatives (expect errors): ${#NEG[@]} files"
run "$OUT/neg.json" "${NEG[@]}"
node "$SUMMARY" "$OUT/neg.json" --expect fail || status=1

exit $status
