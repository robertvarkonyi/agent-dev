#!/usr/bin/env bash
# Claude Code PostToolUse (Edit|Write) hook: a szerkesztett fájlt Prettier-rel formázza.
# A szerkesztett fájl útját a hook-payload stdin JSON `tool_input.file_path` mezőjéből
# olvassuk (a Claude Code nem expandál `$FILE`-t). Fail-soft: sosem blokkol.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null 2>&1

file="$(python3 -c 'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)"
if [ -z "$file" ] || [ ! -f "$file" ]; then exit 0; fi

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.md | *.yml | *.yaml)
    pnpm exec prettier --write "$file" >/dev/null 2>&1 || true
    ;;
esac
exit 0
