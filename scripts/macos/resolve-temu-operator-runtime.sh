#!/bin/zsh

set -u

CONTROLLED_PATH="${1:-}"

resolve_executable() {
  local name="$1"
  local candidate=''
  local directory
  if [[ -n "$CONTROLLED_PATH" ]]; then
    for directory in ${(s/:/)CONTROLLED_PATH}; do
      if [[ -x "$directory/$name" ]]; then
        candidate="$directory/$name"
        break
      fi
    done
  else
    for directory in /opt/homebrew/bin /usr/local/bin; do
      if [[ -x "$directory/$name" ]]; then
        candidate="$directory/$name"
        break
      fi
    done
    if [[ -z "$candidate" ]]; then
      candidate="$(/bin/zsh -lc "command -v $name" 2>/dev/null || true)"
    fi
  fi
  [[ "$candidate" == /* && -x "$candidate" ]] || return 1
  print -r -- "$candidate"
}

NODE_PATH="$(resolve_executable node)" || {
  print -u2 -- 'NODE_RUNTIME_NOT_FOUND: Finder 环境无法解析可执行 Node。'
  exit 20
}
"$NODE_PATH" --version >/dev/null 2>&1 || {
  print -u2 -- 'NODE_RUNTIME_NOT_FOUND: Node 版本验证失败。'
  exit 20
}

NPM_PATH="$(resolve_executable npm)" || {
  print -u2 -- 'NPM_RUNTIME_NOT_FOUND: Finder 环境无法解析可执行 npm。'
  exit 21
}
PATH="${NODE_PATH:h}:${NPM_PATH:h}:/usr/bin:/bin" "$NPM_PATH" --version >/dev/null 2>&1 || {
  print -u2 -- 'NPM_RUNTIME_NOT_FOUND: npm 版本验证失败。'
  exit 21
}

print -r -- "$NODE_PATH"
print -r -- "$NPM_PATH"
