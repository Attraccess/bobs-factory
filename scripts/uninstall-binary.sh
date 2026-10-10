#!/bin/sh
# Remove only receipt-owned immutable runtime files. Never touch Factory state.
set -eu
[ "$#" -eq 2 ] && [ "$2" = --stopped ] || {
  echo 'Usage: uninstall-binary.sh ABSOLUTE_PREFIX --stopped' >&2
  echo 'First drain and stop the worker and disable its service restart. State and PATH entries are retained.' >&2
  exit 1
}
prefix=$1
fail() { echo "Bob's Factory removal: $*" >&2; exit 1; }
case "$prefix" in /*) ;; *) fail 'Prefix must be absolute.';; esac
[ ! -L "$prefix" ] && [ ! -L "$prefix/lib" ] && [ ! -L "$prefix/lib/bobs-factory" ] && [ ! -L "$prefix/bin" ] || fail 'Managed paths must not be symlinks.'
versions=$(cd "$prefix/lib/bobs-factory" && pwd)
[ ! -L "$versions/records" ] || fail 'Records must not be a symlink.'
lock="$versions/.install-lock"
mkdir "$lock" 2>/dev/null || fail 'Install/removal lock exists; inspect before retrying.'
trap 'rmdir "$lock"' EXIT
trap 'exit 130' HUP INT TERM
field() {
  value=$(sed -n "s/^[[:space:]]*\"$2\":[[:space:]]*\"\([^\"]*\)\",\{0,1\}[[:space:]]*$/\1/p" "$1")
  [ -n "$value" ] && [ "$(printf '%s\n' "$value" | wc -l | tr -d ' ')" = 1 ] || fail "Invalid record field: $2"
  printf '%s' "$value"
}
[ -L "$prefix/bin/bobs-factory" ] || fail 'Active executable is not an installer link.'
active=$(readlink "$prefix/bin/bobs-factory")
found=false
# Validate the entire deletion set before removing anything. Unknown files stay.
for record in "$versions"/records/*.json; do
  [ -f "$record" ] && [ ! -L "$record" ] || fail 'Missing or symlinked ownership record.'
  [ "$(field "$record" owner)" = bobs-factory-installer ] && [ "$(field "$record" product)" = bobs-factory ] || fail 'Foreign ownership record.'
  name=${record##*/}; name=${name%.json}
  version=$(field "$record" version)
  target=$(field "$record" target)
  printf '%s' "$version" | LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || fail 'Unsafe version.'
  case "$target" in darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;; *) fail 'Unsafe target.';; esac
  [ "$name" = "bobs-factory-$version-$target" ] || fail 'Ownership filename mismatch.'
  directory="$versions/$name"
  [ -d "$directory" ] && [ ! -L "$directory" ] || fail 'Missing or redirected version directory.'
  [ -z "$(find "$directory" ! -type f ! -type d -print)" ] || fail 'Version contains links or special files.'
  [ "$(field "$directory/build.json" version)" = "$version" ] && [ "$(field "$directory/build.json" target)" = "$target" ] && [ "$(field "$directory/build.json" commit)" = "$(field "$record" commit)" ] || fail 'Build/receipt mismatch.'
  if command -v sha256sum >/dev/null 2>&1; then digest=$(sha256sum "$directory/bobs-factory" | cut -d ' ' -f 1)
  else digest=$(shasum -a 256 "$directory/bobs-factory" | cut -d ' ' -f 1); fi
  [ "$digest" = "$(field "$directory/build.json" sha256)" ] || fail 'Modified executable retained; inspect before removal.'
  if [ "$active" = "$directory/bobs-factory" ]; then found=true; fi
done
[ "$found" = true ] || fail 'Active link is foreign; nothing removed.'
[ ! -L "$versions/previous-link" ] || fail 'Previous link record redirected.'
rm "$prefix/bin/bobs-factory"
for record in "$versions"/records/*.json; do
  name=${record##*/}; name=${name%.json}
  rm -rf "$versions/$name"
  rm "$record"
done
rm -f "$versions/previous-link"
echo 'Removed receipt-owned runtimes. Factory state, native credentials, unknown files and shell PATH entries were retained.'
