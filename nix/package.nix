# Inputs are reviewed immutable local files. Evaluation never fetches latest.
{ pkgs, releaseManifest, releaseSignature, releaseKeyId
, releaseAttestation ? null, releaseAttestationSignature ? null
, releaseAttestationKeyId ? releaseKeyId }:
let
  release = builtins.fromJSON (builtins.readFile releaseManifest);
  pins = (builtins.fromJSON (builtins.readFile ../docs/distribution/release-keys.json)).keys;
  pinned = id: let key = pins.${id} or (throw "Unknown publisher key; obtain fresh reviewed release tooling");
    in if key.status != "active" || key.algorithm != "rsa-sha256" then
      throw "Unsupported or retired publisher key" else pkgs.writeText "bobs-factory-publisher.pem" key.pem;
  publicKey = pinned releaseKeyId;
  attestationKey = pinned releaseAttestationKeyId;
  legacy = release.schemaVersion == 1;
  targets = {
    aarch64-darwin = "darwin-arm64";
    x86_64-darwin = "darwin-x64";
    aarch64-linux = "linux-arm64";
    x86_64-linux = "linux-x64";
  };
  target = targets.${pkgs.stdenv.hostPlatform.system}
    or (throw "Bob's Factory has no binary for this platform");
  entry = release.targets.${target};
in
if release.status != "available" then throw "Verified Bob's Factory release unavailable"
else if !(builtins.elem release.schemaVersion [ 1 2 ]) || release.product != "bobs-factory"
  || release.repository != "jappyjan/bobs-factory" || release.tag != "v${release.version}"
  || entry.archive != "bobs-factory-${release.version}-${target}.tar.gz"
  || builtins.match "[a-f0-9]{64}" entry.archiveSha256 == null then throw "Invalid release manifest"
else if legacy && (builtins.match ".*-beta(\\.[0-9]+)?" release.version == null
  || releaseAttestation == null || releaseAttestationSignature == null) then
  throw "Historical beta requires a signed complete-inventory attestation"
else pkgs.stdenvNoCC.mkDerivation {
  pname = "bobs-factory";
  version = release.version;
  src = pkgs.fetchurl {
    url = "https://github.com/${release.repository}/releases/download/${release.tag}/${entry.archive}";
    sha256 = entry.archiveSha256;
  };
  sourceRoot = "bobs-factory-${release.version}-${target}";
  nativeBuildInputs = [ pkgs.openssl pkgs.jq ]
    ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
  buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];
  # Authentication happens before unpacking. Archive hashes alone are not identity.
  preUnpack = ''
    openssl dgst -sha256 -verify ${publicKey} -signature ${releaseSignature} ${releaseManifest}
  '' + pkgs.lib.optionalString legacy ''
    openssl dgst -sha256 -verify ${attestationKey} -signature ${releaseAttestationSignature} ${releaseAttestation}
    jq -e --slurpfile release ${releaseManifest} \
      --arg manifestHash "$(sha256sum ${releaseManifest} | cut -d ' ' -f1)" \
      --argjson manifestSize "$(wc -c < ${releaseManifest} | tr -d ' ')" \
      -f ${./validate-beta-attestation.jq} ${releaseAttestation} \
      || { echo "Invalid or incomplete historical beta inventory attestation" >&2; exit 1; }
  '';
  postUnpack = ''
    test "$(jq -r '.version' "$sourceRoot/build.json")" = ${pkgs.lib.escapeShellArg release.version}
    test "$(jq -r '.commit' "$sourceRoot/build.json")" = ${pkgs.lib.escapeShellArg release.commit}
    test "$(jq -r '.target' "$sourceRoot/build.json")" = ${pkgs.lib.escapeShellArg target}
    test "$(sha256sum "$sourceRoot/bobs-factory" | cut -d ' ' -f1)" = "$(jq -r '.executable.sha256' "$sourceRoot/build.json")"
  '';
  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin" "$out/libexec/bobs-factory"
    cp bobs-factory build.json LICENSE NOTICE THIRD_PARTY_NOTICES.txt "$out/libexec/bobs-factory/"
    chmod +x "$out/libexec/bobs-factory/bobs-factory"
    ln -s "$out/libexec/bobs-factory/bobs-factory" "$out/bin/bobs-factory"
    runHook postInstall
  '';
  meta = {
    description = "Self-hosted software factory";
    homepage = "https://jappyjan.github.io/bobs-factory/";
    license = pkgs.lib.licenses.asl20;
    platforms = builtins.attrNames targets;
    mainProgram = "bobs-factory";
  };
}
