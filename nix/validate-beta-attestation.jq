# Run only after both publisher signatures have been verified. The inventory
# authenticates all release assets; it does not require downloading other targets.
def valid_record:
  type == "object"
  and (.file | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9.-]*$"))
  and (.sha256 | type == "string" and test("^[a-f0-9]{64}$"))
  and (.size | type == "number" and . > 0 and . <= 9007199254740991 and floor == .);

["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as $targets
| $release[0] as $r
| . as $a
| ["release-evidence.json", "validation-receipts.tar.gz", "build-provenance.json",
   ($targets[] | "runtime-smoke-\(.).txt", "native-helpers-\(.).json",
                 "prepared-agent-boundaries-\(.).json")] as $evidence
| [$r.installer, $r.verifier, $r.source,
   ($targets[] as $t | $r.targets[$t]
    | {file: .archive, sha256: .archiveSha256, size: .archiveSize},
      {file: .manifest, sha256: .manifestSha256, size: .manifestSize})] as $records
| .schemaVersion == 1 and .product == "bobs-factory"
  and .repository == $r.repository and .version == $r.version
  and .tag == $r.tag and .commit == $r.commit
  and (.manifest | valid_record)
  and .manifest.file == "release.json"
  and .manifest.sha256 == $manifestHash and .manifest.size == $manifestSize
  and ($r.targets | keys | sort) == ($targets | sort)
  and $r.installer.file == "install.sh" and $r.verifier.file == "install-binary.sh"
  and $r.source.file == "source-rebuild.tar.gz"
  and all($targets[]; . as $t | $r.targets[$t]
    | .archive == "bobs-factory-\($r.version)-\($t).tar.gz"
      and .manifest == "bobs-factory-\($r.version)-\($t).manifest.json")
  and (.assets | type == "array" and length > 0)
  and all(.assets[]; valid_record
    and (.file as $f | ["release.json", "release.json.sig", "release.json.key-id",
                        "release-attestation.json", "release-attestation.json.sig",
                        "release-attestation.json.key-id"] | index($f) == null))
  and (.assets | map(.file) | length == (unique | length))
  and all($records[]; valid_record and (. as $record
    | any($a.assets[]; .file == $record.file and .sha256 == $record.sha256 and .size == $record.size)))
  and all($evidence[]; . as $file | any($a.assets[]; .file == $file))
