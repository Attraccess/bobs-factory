// Local operator authorization. This command never starts or restarts services.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	authorizeFactoryEnrollment,
	requestFactoryAuthRecovery,
} from "../packages/edge-worker/dist/factory/FactoryAuthOperator.js";

const { values } = parseArgs({
	options: {
		home: { type: "string", default: join(homedir(), ".bobs-factory") },
		recover: { type: "boolean" },
		confirm: { type: "string" },
	},
});
const home = resolve(values.home!.replace(/^~(?=\/)/, homedir()));
if (values.recover) {
	requestFactoryAuthRecovery(home, values.confirm);
	console.log(
		"Factory authentication recovery requested. All sessions will be revoked. Use the new code from factory/auth/enroll.json.",
	);
} else {
	console.log(
		`Single-use setup code (expires in ten minutes): ${authorizeFactoryEnrollment(home)}\nEnter it on the Factory passkey setup screen at the address where you will use that key.`,
	);
}
