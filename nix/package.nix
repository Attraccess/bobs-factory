# Pin releaseManifest to a reviewed release.json file, rather than fetching a
# mutable latest pointer during evaluation. All platforms use that one manifest.
{ pkgs, releaseManifest }:
let
  release = builtins.fromJSON (builtins.readFile releaseManifest);
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
if release.status != "available" then
  throw "Bob's Factory public release is not available yet"
else if !(builtins.elem release.schemaVersion [ 1 2 ]) || release.product != "bobs-factory"
  || release.repository != "jappyjan/bobs-factory"
  || release.tag != "v${release.version}"
  || entry.archive != "bobs-factory-${release.version}-${target}.tar.gz"
  || builtins.match "[a-f0-9]{64}" entry.archiveSha256 == null then
  throw "Invalid Bob's Factory release manifest"
else pkgs.stdenvNoCC.mkDerivation {
  pname = "bobs-factory";
  version = release.version;
  src = pkgs.fetchurl {
    url = "https://github.com/${release.repository}/releases/download/${release.tag}/${entry.archive}";
    sha256 = entry.archiveSha256;
  };
  sourceRoot = "bobs-factory-${release.version}-${target}";
  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;
  nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
  buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];
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
