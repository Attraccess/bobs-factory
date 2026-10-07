#!/usr/bin/env sh
set -eu
# Install an explicitly selected, trusted release. Mutable state is never touched.
[ "$#" -eq 3 ] || { echo 'Usage: install-binary.sh ARCHIVE MANIFEST PREFIX' >&2; exit 1; }
archive=$1
manifest=$2
prefix=$3
field() {
  result=$(sed -n "s/^[[:space:]]*\"$2\":[[:space:]]*\"\([^\"]*\)\",\{0,1\}[[:space:]]*$/\1/p" "$1")
  [ -n "$result" ] && [ "$(printf '%s\n' "$result" | wc -l | tr -d ' ')" = 1 ] || { echo "Invalid manifest field: $2" >&2; exit 1; }
  printf '%s' "$result"
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
number() {
  result=$(sed -n "s/^[[:space:]]*\"$2\":[[:space:]]*\([0-9][0-9]*\),\{0,1\}[[:space:]]*$/\1/p" "$1")
  [ -n "$result" ] && [ "$(printf '%s\n' "$result" | wc -l | tr -d ' ')" = 1 ] || { echo "Invalid numeric manifest field: $2" >&2; exit 1; }
  printf '%s' "$result"
}
[ "$(number "$manifest" schemaVersion)" = 1 ] || { echo 'Unsupported manifest schema' >&2; exit 1; }
product=$(field "$manifest" product)
version=$(field "$manifest" version)
target=$(field "$manifest" target)
expected=$(field "$manifest" sha256)
file=$(field "$manifest" file)
commit=$(field "$manifest" commit)
printf '%s' "$commit" | LC_ALL=C grep -Eq '^[a-f0-9]{40}$' || { echo 'Invalid source commit' >&2; exit 1; }
[ "$(wc -c < "$archive" | tr -d ' ')" = "$(number "$manifest" size)" ] || { echo 'Archive size mismatch' >&2; exit 1; }
[ "$product" = bobs-factory ] || { echo 'Wrong product' >&2; exit 1; }
printf '%s' "$version" | LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || { echo 'Invalid version' >&2; exit 1; }
printf '%s' "$expected" | LC_ALL=C grep -Eq '^[a-f0-9]{64}$' || { echo 'Invalid SHA-256' >&2; exit 1; }
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) native=darwin-arm64;; Darwin-x86_64) native=darwin-x64;;
  Linux-x86_64) native=linux-x64;; Linux-aarch64|Linux-arm64) native=linux-arm64;;
  *) echo 'Unsupported operating system or CPU' >&2; exit 1;;
esac
[ "$target" = "$native" ] || { echo "Archive target $target does not match $native" >&2; exit 1; }
name="bobs-factory-$version-$target"
[ "$file" = "$name.tar.gz" ] || { echo 'Archive filename mismatch' >&2; exit 1; }
[ "$(sha256 "$archive")" = "$expected" ] || { echo 'Archive checksum mismatch' >&2; exit 1; }
# Restrict members and types before extraction. No links, traversal or special files.
listing=$(tar -tzf "$archive")
# Require one product root, regular files/directories only, and safe sidecar paths.
printf '%s\n' "$listing" | LC_ALL=C grep -Ev "^$name(/|/(bobs-factory|LICENSE|NOTICE|THIRD_PARTY_NOTICES.txt|build.json)|/node_modules/?|/node_modules/[A-Za-z0-9_@.$+/-]+/?)$" > /dev/null && { echo 'Unexpected archive member' >&2; exit 1; }
printf '%s\n' "$listing" | LC_ALL=C grep -E '(^|/)\.\.?(/|$)|//' > /dev/null && { echo 'Unsafe archive member' >&2; exit 1; }
[ "$(printf '%s\n' "$listing" | wc -l | tr -d ' ')" = "$(printf '%s\n' "$listing" | sort -u | wc -l | tr -d ' ')" ] || { echo 'Duplicate archive member' >&2; exit 1; }
for required in bobs-factory LICENSE NOTICE build.json THIRD_PARTY_NOTICES.txt; do
  printf '%s\n' "$listing" | grep -Fx "$name/$required" >/dev/null || { echo 'Missing archive member' >&2; exit 1; }
done
tar -tvzf "$archive" | LC_ALL=C grep -Ev '^[-d]' > /dev/null && { echo 'Links or special files in archive' >&2; exit 1; }
umask 077
mkdir -p "$prefix/lib/bobs-factory" "$prefix/bin"
versions=$(cd "$prefix/lib/bobs-factory" && pwd)
lock="$versions/.install-lock"
mkdir "$lock" 2>/dev/null || { echo 'Another installation or interrupted installer owns the lock; inspect before retrying' >&2; exit 1; }
stage=
trap '[ -z "$stage" ] || rm -rf "$stage"; rmdir "$lock"' EXIT
trap 'exit 130' HUP INT TERM
[ ! -e "$versions/$name" ] || { echo 'Immutable version already installed; refusing overwrite' >&2; exit 1; }
if [ -e "$prefix/bin/bobs-factory" ] || [ -L "$prefix/bin/bobs-factory" ]; then
  [ -L "$prefix/bin/bobs-factory" ] || { echo 'Existing executable is not an owned version link; move it to a backup first' >&2; exit 1; }
  case "$(readlink "$prefix/bin/bobs-factory")" in "$versions"/bobs-factory-*/bobs-factory) ;; *) echo 'Existing link is not owned by this installer' >&2; exit 1;; esac
fi
stage=$(mktemp -d "$versions/.install-XXXXXX")
tar -xzf "$archive" -C "$stage"
[ "$(number "$stage/$name/build.json" schemaVersion)" = 1 ] || { echo 'Unsupported build schema' >&2; exit 1; }
[ "$(field "$stage/$name/build.json" product)" = "$product" ] || { echo 'Build product mismatch' >&2; exit 1; }
[ "$(field "$stage/$name/build.json" commit)" = "$commit" ] || { echo 'Build source mismatch' >&2; exit 1; }
[ "$(field "$stage/$name/build.json" version)" = "$version" ] || { echo 'Build version mismatch' >&2; exit 1; }
[ "$(field "$stage/$name/build.json" target)" = "$target" ] || { echo 'Build target mismatch' >&2; exit 1; }
[ "$(sha256 "$stage/$name/bobs-factory")" = "$(field "$stage/$name/build.json" sha256)" ] || { echo 'Executable integrity failure' >&2; exit 1; }
[ "$(wc -c < "$stage/$name/bobs-factory" | tr -d ' ')" = "$(number "$stage/$name/build.json" size)" ] || { echo 'Executable size mismatch' >&2; exit 1; }
chmod 755 "$stage/$name/bobs-factory"
mv "$stage/$name" "$versions/$name"
if [ -L "$prefix/bin/bobs-factory" ]; then
  readlink "$prefix/bin/bobs-factory" > "$stage/previous-link"
  mv -f "$stage/previous-link" "$versions/previous-link"
fi
ln -s "$versions/$name/bobs-factory" "$stage/next"
mv -f "$stage/next" "$prefix/bin/bobs-factory"
echo "Installed $version. Add $prefix/bin to PATH. Previous versions are retained."
