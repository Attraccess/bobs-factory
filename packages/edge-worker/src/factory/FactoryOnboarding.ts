import type { RunnerType } from "bobs-factory-core";

/** Local-launch setup is provided by the machine-owning CLI, behind passkey access. */
export interface FactoryOnboarding {
	status(): unknown | Promise<unknown>;
	configure(input: {
		repositoryPath: string;
		runner: RunnerType;
	}): Promise<unknown>;
	connectGithub(input: { token: string }): Promise<unknown>;
}
