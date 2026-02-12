#!/bin/bash
# Pre-commit hook to prevent accidental nsec exposure in committed files.
#
# Installation:
#   cp scripts/check-nsec.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or add to your existing pre-commit hook:
#   source scripts/check-nsec.sh
#
# This script scans staged files for nsec1 private keys and blocks the
# commit if any are found. It ignores known safe files like test helpers
# and documentation that reference nsec as a concept (not actual keys).

set -e

# Files that are allowed to mention "nsec" as a concept (not real keys)
ALLOWED_PATTERNS=(
  "e2e/helpers/auth.ts"
  "TESTING.md"
  "AGENTS.md"
  ".env.example"
  "PRD.md"
  "scripts/check-nsec.sh"
  "package.json"
)

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

FOUND_NSEC=0

for FILE in $STAGED_FILES; do
  # Skip binary files
  if file "$FILE" | grep -q "binary"; then
    continue
  fi

  # Skip allowed files
  SKIP=0
  for PATTERN in "${ALLOWED_PATTERNS[@]}"; do
    if [[ "$FILE" == *"$PATTERN"* ]]; then
      SKIP=1
      break
    fi
  done

  if [ "$SKIP" -eq 1 ]; then
    continue
  fi

  # Check for nsec1 keys (actual bech32-encoded private keys)
  # nsec1 keys are 63 characters: "nsec1" + 58 bech32 chars
  if grep -nP 'nsec1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}' "$FILE" 2>/dev/null; then
    echo "ERROR: Possible nsec private key found in $FILE"
    FOUND_NSEC=1
  fi

  # Also check for raw .env file content with actual nsec values
  if [[ "$FILE" == ".env" ]]; then
    if grep -nP 'TEST_NSEC=nsec1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}' "$FILE" 2>/dev/null; then
      echo "ERROR: .env file with nsec value should not be committed!"
      FOUND_NSEC=1
    fi
  fi
done

if [ "$FOUND_NSEC" -eq 1 ]; then
  echo ""
  echo "=========================================="
  echo "  COMMIT BLOCKED: nsec private key detected"
  echo "=========================================="
  echo ""
  echo "Private keys (nsec1...) must NEVER be committed to the repository."
  echo "Please remove the private key from the staged files."
  echo ""
  echo "If this is a test file that references nsec format as documentation,"
  echo "add the file to the ALLOWED_PATTERNS list in scripts/check-nsec.sh."
  echo ""
  exit 1
fi

exit 0
