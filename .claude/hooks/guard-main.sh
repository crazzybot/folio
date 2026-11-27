#!/bin/bash
# PreToolUse hook for Bash: blocks `git commit` and `git push` on main.
# CLAUDE.md says never to commit or push to main; this makes the harness
# enforce it rather than leaving it to the model to remember.
#
# Input: the hook's JSON on stdin (tool_input.command, cwd).
# Exit 2 blocks the command, and its stderr is shown to Claude.

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
[ -n "$cwd" ] || cwd=$PWD

# A git invocation, with optional global options, running commit or push.
git_op='(^|[;&|(]|[[:space:]])git([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+|[[:space:]]+--[^[:space:]]+)*[[:space:]]+'
printf '%s' "$cmd" | grep -Eq "${git_op}(commit|push)([[:space:]]|$)" || exit 0

# The repository the command runs in: `git -C <dir>`, else the last
# `cd <dir>` in the command, else the session's working directory.
dir=$(printf '%s' "$cmd" | grep -Eo 'git[[:space:]]+-C[[:space:]]+[^[:space:];&|]+' | tail -1 | awk '{print $3}')
[ -n "$dir" ] || dir=$(printf '%s' "$cmd" | grep -Eo '(^|[;&|(][[:space:]]*)cd[[:space:]]+[^[:space:];&|)]+' | tail -1 | awk '{print $NF}')
dir=${dir%\"}; dir=${dir#\"}; dir=${dir%\'}; dir=${dir#\'}
dir=${dir/#\~/$HOME}
case "$dir" in
  "") dir=$cwd ;;
  /*) ;;
  *) dir="$cwd/$dir" ;;
esac

branch=$(git -C "$dir" branch --show-current 2>/dev/null)

block() {
  echo "Blocked: $1 CLAUDE.md: never commit to main, and never push to it. Create a branch from an up-to-date main (feat/…, fix/…, docs/…, chore/…) and commit there." >&2
  exit 2
}

if [ "$branch" = "main" ]; then
  printf '%s' "$cmd" | grep -Eq "${git_op}commit([[:space:]]|$)" && block "this commits to main (in $dir)."
  printf '%s' "$cmd" | grep -Eq "${git_op}push([[:space:]]|$)" && block "this pushes from main (in $dir)."
fi

# A push that names main as its target, from any branch: `origin main`,
# `HEAD:main`, `refs/heads/main`.
printf '%s' "$cmd" | grep -Eq "${git_op}push([[:space:]]+[^;&|]*)?([[:space:]:]|refs/heads/)main([[:space:];&|)]|$)" \
  && block "this pushes to main."

exit 0
