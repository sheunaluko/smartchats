#!/usr/bin/env bash
# Shared helpers sourced by other bin/ scripts. Don't execute directly.

# -- Repo root --
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -- Color helpers (respect NO_COLOR) --
if [[ -z "${NO_COLOR:-}" ]] && [[ -t 2 ]]; then
  _C_RED='\033[0;31m'
  _C_GREEN='\033[0;32m'
  _C_YELLOW='\033[0;33m'
  _C_BLUE='\033[0;34m'
  _C_BOLD='\033[1m'
  _C_RESET='\033[0m'
else
  _C_RED='' _C_GREEN='' _C_YELLOW='' _C_BLUE='' _C_BOLD='' _C_RESET=''
fi

info()   { echo -e "${_C_BLUE}[info]${_C_RESET} $*" >&2; }
ok()     { echo -e "${_C_GREEN}[ok]${_C_RESET} $*" >&2; }
warn()   { echo -e "${_C_YELLOW}[warn]${_C_RESET} $*" >&2; }
err()    { echo -e "${_C_RED}[err]${_C_RESET} $*" >&2; }
header() { echo -e "\n${_C_BOLD}==> $*${_C_RESET}" >&2; }

check_command() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    err "Required command not found: $cmd"
    return 1
  fi
}
