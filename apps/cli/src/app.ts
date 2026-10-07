#!/usr/bin/env node
import "reflect-metadata";
import { isPackagedExecutable } from "bobs-factory-core";

if (isPackagedExecutable)
	process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE = process.execPath;
else delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
if (process.argv[2] === "internal") {
	const { runInternal } = await import("./internal.js");
	await runInternal(process.argv.slice(3));
} else {
	await import("./cli.js");
}
