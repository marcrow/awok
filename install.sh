#!/usr/bin/env bash
# awok installer — from scratch.
# Creates a dedicated virtualenv, installs the Python deps, and puts the
# `awok` and `bb-workflow` commands on your PATH (via small
# wrapper scripts that run the venv interpreter, so nothing pollutes system
# Python). Idempotent: re-running refreshes the venv and the wrappers.
#
# Usage:   ./install.sh
# Override: PYTHON=python3.12 AWOK_BIN=~/bin ./install.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${PYTHON:-python3}"
VENV="$HERE/.venv"
BINDIR="${AWOK_BIN:-$HOME/.local/bin}"
SCRIPTS="$HERE/src/scripts"

command -v "$PY" >/dev/null 2>&1 || { echo "✗ '$PY' introuvable. Installe Python 3."; exit 1; }

echo "→ venv : $VENV"
[ -d "$VENV" ] || "$PY" -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$HERE/requirements.txt"

mkdir -p "$BINDIR"
make_wrapper() {  # $1 = command name, $2 = target script
  rm -f "$BINDIR/$1"   # drop any stale symlink/wrapper (e.g. a dangling link)
  cat > "$BINDIR/$1" <<EOF
#!/usr/bin/env bash
exec "$VENV/bin/python" "$2" "\$@"
EOF
  chmod +x "$BINDIR/$1"
}
make_wrapper awok          "$SCRIPTS/bb-workflow"
make_wrapper bb-workflow   "$SCRIPTS/bb-workflow"
echo "→ commandes installées dans $BINDIR : awok, bb-workflow"

# Deploy the generated skills + their agents so the workflows are invocable in
# Claude Code (the orchestrator reads ~/.claude/skills/<wf>/SKILL.md and dispatches
# the agents from ~/.claude/agents/). Additive copy — never deletes skills/agents
# that awok does not own. Override the target with CLAUDE_HOME=...
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
if [ -d "$HERE/src/skills" ] && [ -n "$(ls -A "$HERE/src/skills" 2>/dev/null)" ]; then
  mkdir -p "$CLAUDE_HOME/skills"
  cp -R "$HERE/src/skills/." "$CLAUDE_HOME/skills/"
  n_skills=$(find "$HERE/src/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  echo "→ $n_skills skill(s) déployé(s) dans $CLAUDE_HOME/skills/"
fi
if [ -d "$HERE/src/agents" ] && [ -n "$(ls -A "$HERE/src/agents" 2>/dev/null)" ]; then
  mkdir -p "$CLAUDE_HOME/agents"
  cp -R "$HERE/src/agents/." "$CLAUDE_HOME/agents/"
  n_agents=$(find "$HERE/src/agents" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
  echo "→ $n_agents agent(s) déployé(s) dans $CLAUDE_HOME/agents/"
fi

case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "⚠ $BINDIR n'est pas dans ton PATH — ajoute :  export PATH=\"$BINDIR:\$PATH\"" ;;
esac

echo "✓ installé. Essaie :  awok validate"
echo "  (tests : $VENV/bin/pip install pytest && $VENV/bin/python -m pytest src/scripts/tests/)"
