#!/bin/sh
# Public installer. No GitHub login, gh, jq, Node, Bun or sudo required.
set -eu

repository=jappyjan/bobs-factory
site=https://jappyjan.github.io/bobs-factory
prefix=${BOBS_FACTORY_INSTALL_PREFIX:-"$HOME/.local"}
version=
channel=stable
channel_explicit=false
modify_path=true
usage() {
  echo 'Usage: install.sh [--prefix DIRECTORY] [--version VERSION] [--channel stable|nightly] [--no-modify-path]'
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix|--version|--channel)
      [ "$#" -ge 2 ] || { usage >&2; exit 1; }
      case "$1" in --prefix) prefix=$2;; --version) version=$2;; --channel) channel=$2; channel_explicit=true;; esac
      shift 2;;
    --no-modify-path) modify_path=false; shift;;
    --help) usage; exit 0;;
    *) usage >&2; exit 1;;
  esac
done
fail() { echo "Bob's Factory: $*" >&2; exit 1; }
case "$prefix" in /*) ;; *) fail 'Install prefix must be an absolute path.';; esac
case "$prefix" in *:*) fail 'Install prefix must not contain a PATH separator (:).';; esac
case "$prefix" in *'
'*) fail 'Install prefix must not contain a newline.';; esac
case "$channel" in stable|nightly) ;; *) fail 'Channel must be stable or nightly.';; esac
for tool in openssl curl tar sed awk grep cut wc uname mktemp diff find; do
  command -v "$tool" >/dev/null 2>&1 || fail "Required system tool is missing: $tool"
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  fail 'A SHA-256 tool (sha256sum or shasum) is required.'
fi
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=darwin-arm64;; Darwin-x86_64) target=darwin-x64;;
  Linux-x86_64) target=linux-x64;; Linux-aarch64|Linux-arm64) target=linux-arm64;;
  *) fail 'Supported platforms: macOS Apple Silicon/Intel and Linux ARM64/x64 with glibc.';;
esac
if [ "${target#linux-}" != "$target" ] && command -v ldd >/dev/null 2>&1; then
  case "$(ldd --version 2>&1 || true)" in *musl*) fail 'Linux builds require glibc; musl/Alpine is not supported.';; esac
fi
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/bobs-factory-install.XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'exit 130' HUP INT TERM
download() {
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 15 --max-time 300 \
    --proto '=https' --proto-redir '=https' "$1" --output "$2" || fail 'Download failed. Check your connection and try again.'
}
field() {
  value=$(sed -n "s/^[[:space:]]*\"$2\":[[:space:]]*\"\([^\"]*\)\",\{0,1\}[[:space:]]*$/\1/p" "$1")
  [ -n "$value" ] && [ "$(printf '%s\n' "$value" | wc -l | tr -d ' ')" = 1 ] || fail "Invalid release field: $2"
  printf '%s' "$value"
}
number() {
  value=$(sed -n "s/^[[:space:]]*\"$2\":[[:space:]]*\([0-9][0-9]*\),\{0,1\}[[:space:]]*$/\1/p" "$1")
  [ -n "$value" ] && [ "$(printf '%s\n' "$value" | wc -l | tr -d ' ')" = 1 ] || fail "Invalid release number: $2"
  printf '%s' "$value"
}
section() {
  # The publisher emits canonical two-space JSON. Ambiguous/duplicate sections fail.
  awk -v key="$2" '$0 == "    \"" key "\": {" || $0 == "  \"" key "\": {" { count++; active=1; next } active && /^  +}[,]?$/ { active=0; next } active { print } END { if (count != 1) exit 1 }' "$1" > "$3" || fail "Invalid release section: $2"
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
verify() {
  expected_hash=$2
  printf '%s' "$expected_hash" | LC_ALL=C grep -Eq '^[a-f0-9]{64}$' || fail 'Invalid release checksum.'
  [ "$(wc -c < "$1" | tr -d ' ')" = "$3" ] || fail 'Downloaded file size does not match the release.'
  [ "$(sha256 "$1")" = "$expected_hash" ] || fail 'Downloaded file checksum does not match the release.'
}
valid_version() {
  printf '%s' "$1" | LC_ALL=C grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$' || return 1
  case "$1" in *-*) ! printf '%s' "${1#*-}" | LC_ALL=C grep -Eq '(^|\.)0[0-9]+($|\.)';; *) return 0;; esac
}
if [ -n "$version" ]; then
  valid_version "$version" || fail 'Invalid version.'
  metadata="https://github.com/$repository/releases/download/v$version/release.json"
else
  case "$channel" in stable) metadata="$site/releases/latest.json";; nightly) metadata="$site/releases/nightly.json";; esac
fi
echo "Finding Bob's Factory for $target..."
download "$metadata" "$work/release.json"
# Pending website metadata is an unsigned availability hint. It can only stop
# installation; it cannot authorize downloads or execution of release assets.
if [ "$(field "$work/release.json" status)" = pending ]; then
  [ "$(number "$work/release.json" schemaVersion)" = 2 ] || fail 'Unsupported release metadata. Download a fresh installer.'
  [ "$(field "$work/release.json" product)" = bobs-factory ] || fail 'Unexpected product in release metadata.'
  [ "$(field "$work/release.json" repository)" = "$repository" ] || fail 'Unexpected release repository.'
  fail "No verified $channel release is available. Please check the homepage for availability."
fi
# Authenticate exact bytes before accepting any installable release fields or code.
verify_signature() {
  key_id=$(cat "$3")
  printf '%s' "$key_id" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9-]{0,63}$' || fail 'Malformed publisher key identifier.'
# BEGIN PINNED RELEASE KEYS
case "$key_id" in
  *) fail 'Unknown or retired publisher key. Obtain a fresh trusted installer; release rollout may still be pending.';;
esac
# END PINNED RELEASE KEYS
  openssl dgst -sha256 -verify "$work/publisher.pem" -signature "$2" "$1" >/dev/null 2>&1 || fail 'Invalid publisher signature. No installed files were changed.'
}
download "$metadata.sig" "$work/release.json.sig"
download "$metadata.key-id" "$work/release.json.key-id"
verify_signature "$work/release.json" "$work/release.json.sig" "$work/release.json.key-id"
schema=$(number "$work/release.json" schemaVersion)
case "$schema" in 1|2) ;; *) fail 'Unsupported release metadata. Download a fresh installer.';; esac
[ "$(field "$work/release.json" product)" = bobs-factory ] || fail 'Unexpected product in release metadata.'
[ "$(field "$work/release.json" repository)" = "$repository" ] || fail 'Unexpected release repository.'
status=$(field "$work/release.json" status)
[ "$status" = available ] || fail 'The first public release is being prepared. Please check the homepage for availability.'
release_version=$(field "$work/release.json" version)
valid_version "$release_version" || fail 'Invalid release version.'
[ -z "$version" ] || [ "$version" = "$release_version" ] || fail 'Requested version does not match release metadata.'
case "$release_version" in
  *-nightly.*) release_channel=nightly;;
  *-beta|*-beta.*) release_channel=beta;;
  *-*) fail 'Unsupported release channel.';;
  *) release_channel=stable;;
esac
case "$channel:$release_channel" in
  stable:stable|nightly:nightly) ;;
  stable:beta) [ "$channel_explicit" = false ] || fail 'Requested channel does not match the signed version.';;
  *) fail 'Requested channel does not match the signed version.';;
esac
if [ "$schema" = 2 ]; then
  [ "$(field "$work/release.json" channel)" = "$release_channel" ] || fail 'Signed release channel mismatch.'
else
  [ "$release_channel" = beta ] || fail 'Legacy metadata is supported only for an authenticated beta.'
fi
tag=$(field "$work/release.json" tag)
[ "$tag" = "v$release_version" ] || fail 'Invalid immutable release tag.'
commit=$(field "$work/release.json" commit)
printf '%s' "$commit" | LC_ALL=C grep -Eq '^[a-f0-9]{40}$' || fail 'Invalid immutable release source.'
section "$work/release.json" "$target" "$work/target.json"
section "$work/release.json" verifier "$work/verifier.json"
archive=$(field "$work/target.json" archive)
manifest=$(field "$work/target.json" manifest)
verifier=$(field "$work/verifier.json" file)
[ "$archive" = "bobs-factory-$release_version-$target.tar.gz" ] || fail 'Unexpected archive filename.'
[ "$manifest" = "bobs-factory-$release_version-$target.manifest.json" ] || fail 'Unexpected manifest filename.'
[ "$verifier" = install-binary.sh ] || fail 'Unexpected verifier filename.'
base="https://github.com/$repository/releases/download/$tag"
if [ "$schema" = 1 ]; then
  download "$base/release-attestation.json" "$work/attestation.json"
  download "$base/release-attestation.json.sig" "$work/attestation.sig"
  download "$base/release-attestation.json.key-id" "$work/attestation.key-id"
  verify_signature "$work/attestation.json" "$work/attestation.sig" "$work/attestation.key-id"
  section "$work/attestation.json" manifest "$work/attested-manifest.json"
  verify "$work/release.json" "$(field "$work/attested-manifest.json" sha256)" "$(number "$work/attested-manifest.json" size)"
fi
echo "Downloading $release_version..."
case "$release_channel" in beta) printf 'This is a verified beta of Bob\047s Factory until stable is available.\n';; nightly) echo 'Nightly is an opt-in prerelease.';; esac
download "$base/$archive" "$work/$archive"
download "$base/$manifest" "$work/$manifest"
download "$base/$verifier" "$work/$verifier"
verify "$work/$archive" "$(field "$work/target.json" archiveSha256)" "$(number "$work/target.json" archiveSize)"
verify "$work/$manifest" "$(field "$work/target.json" manifestSha256)" "$(number "$work/target.json" manifestSize)"
verify "$work/$verifier" "$(field "$work/verifier.json" sha256)" "$(number "$work/verifier.json" size)"
[ "$(field "$work/$manifest" commit)" = "$commit" ] || fail 'Archive source does not match the release.'
[ "$(field "$work/$manifest" version)" = "$release_version" ] || fail 'Archive version does not match the release.'
key_id=$(cat "$work/release.json.key-id")
BOBS_FACTORY_INSTALL_CHANNEL="$release_channel" \
BOBS_FACTORY_INSTALL_SOURCE=bootstrap \
BOBS_FACTORY_INSTALL_KEY_ID="$key_id" \
  sh "$work/$verifier" "$work/$archive" "$work/$manifest" "$prefix"

shell_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
bin=$(shell_quote "$prefix/bin")
profile=${BOBS_FACTORY_INSTALL_PROFILE:-}
if [ "$modify_path" = true ]; then
  if [ -z "$profile" ]; then
    case "${SHELL:-}" in
      */zsh) profile="${ZDOTDIR:-$HOME}/.zshrc";;
      */bash) case "$target" in darwin-*) profile="$HOME/.bash_profile";; *) profile="$HOME/.bashrc";; esac;;
      */fish) profile="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/bobs-factory.fish";;
      *) profile="$HOME/.profile";;
    esac
  fi
  case "$profile" in *'
'*) fail 'Shell profile must not contain a newline.';; esac
  if [ -L "$profile" ] || { [ -e "$profile" ] && [ ! -w "$profile" ]; }; then
    echo "Shell profile is managed elsewhere; leaving it unchanged."
  elif grep -Fx "# Bob's Factory PATH: $prefix/bin" "$profile" >/dev/null 2>&1; then
    echo 'Shell PATH is already configured.'
  elif mkdir -p "$(dirname "$profile")" && { [ ! -e "$profile" ] || cp -p "$profile" "$profile.bobs-factory-backup"; }; then
    case "${SHELL:-}" in
      */fish) printf '\n# Bob\047s Factory PATH: %s/bin\nfish_add_path %s\n' "$prefix" "$bin" >> "$profile";;
      *) printf '\n# Bob\047s Factory PATH: %s/bin\ncase ":$PATH:" in *:%s:*) ;; *) export PATH=%s:"$PATH";; esac\n' "$prefix" "$bin" "$bin" >> "$profile";;
    esac
    echo "Configured PATH in $profile. Open a new terminal to use bobs-factory by name."
  else
    echo 'Could not update your shell profile; use the full executable path below.'
  fi
fi
echo
printf 'Start Bob\047s Factory now: '
shell_quote "$prefix/bin/bobs-factory"
printf '\n'
