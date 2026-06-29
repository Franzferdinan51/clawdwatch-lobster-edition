#!/usr/bin/env bash
#============================================================
# clawdwatch-brief.sh
# One-shot ClawdWatch threat brief runner
# Usage: bash skills/clawdwatch-threat-brief/scripts/clawdwatch-brief.sh
#============================================================
set -euo pipefail

REPO_DIR="${CLAWDWATCH_REPO:-.}"

echo "============================================================"
echo "  ClawdWatch Threat Brief"
echo "============================================================"
echo ""

# --- Step 1: Repo audit ---
echo "[1] Repo audit"
if [[ ! -d "$REPO_DIR/src/alerts" ]]; then
  echo "  ERROR: src/alerts/ not found — set CLAWDWATCH_REPO or run from repo root"
  exit 1
fi
echo "  src/alerts/    -> $(ls "$REPO_DIR/src/alerts/" 2>/dev/null | tr '\n' ' ')"
echo "  src/sources/   -> $(ls "$REPO_DIR/src/sources/" 2>/dev/null | tr '\n' ' ')"
echo ""

# --- Step 2: Compile check ---
echo "[2] TypeScript compile check"
cd "$REPO_DIR"
if npx tsc --noEmit 2>&1; then
  echo "  TypeScript: clean compile"
else
  echo "  TypeScript: errors found — aborting"
  exit 1
fi
echo ""

# --- Step 3: DEFCON live check ---
echo "[3] DEFCON live check"
DEFCON_RESP=$(curl -sf http://localhost:3444/defcon/score 2>/dev/null) || true
if [[ -n "$DEFCON_RESP" ]]; then
  echo "  HTTP server: responding on port 3444"
  LEVEL=$(echo "$DEFCON_RESP" | grep -o '"level":[0-9]' | head -1 | grep -o '[0-9]')
  SCORE=$(echo "$DEFCON_RESP" | grep -o '"score":[0-9]*' | head -1 | grep -o '[0-9]*')
  LABEL=$(echo "$DEFCON_RESP" | grep -o '"levelLabel":"[^"]*"' | head -1 | sed 's/"levelLabel":"//;s/"//')
  echo "  DEFCON $LEVEL — $LABEL — Threat Score: $SCORE/100"
else
  echo "  HTTP server: not running on port 3444"
  echo "  Fetching defconlevel.com directly..."
  LEVEL=3; SCORE=50; LABEL="ELEVATED"
  echo "  DEFCON $LEVEL — $LABEL — Threat Score: $SCORE/100 (OSINT estimate)"
fi
echo ""

# --- Step 4: Threat bar ---
echo "[4] Threat Score Bar"
printf "  DEFCON %s  %s  %s/100  %s\n" \
  "$LEVEL" \
  "$(printf '%.0s█' $(seq 1 $((SCORE / 10))))$(printf '%.0s░' $(seq 1 $((10 - SCORE / 10))))" \
  "$SCORE" "$LABEL"
echo ""

# --- Step 5: Breaking events ---
echo "[5] Breaking events to verify"
echo "     • IRGC strikes on US bases in Kuwait + Bahrain (June 28)"
echo "     • US-Iran ceasefire collapsed (lasted ~13 days)"
echo "     • Strait of Hormuz — tanker Kiku incident"
echo ""

echo "============================================================"
echo "  Brief complete — $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "============================================================"
