/** Credential-free forge coordinates, shared by runtime and review links. */
export function repositoryReference(value: string): {
	host: string;
	project: string;
	url: string;
} {
	const text = value.trim();
	const scp = /^(?:[^@/:]+@)?([^/:]+):([^/].*)$/.exec(text);
	const url = new URL(
		scp && !text.includes("://") ? `ssh://${scp[1]}/${scp[2]}` : text,
	);
	if (
		!["https:", "http:", "ssh:"].includes(url.protocol) ||
		url.password ||
		(url.protocol !== "ssh:" && url.username) ||
		url.search ||
		url.hash
	)
		throw new Error("Use a credential-free Git remote or repository URL");
	const project = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
	if (
		!project ||
		project
			.split("/")
			.some((p) => !/^[\w.-]+$/.test(p) || [".", ".."].includes(p))
	)
		throw new Error("Invalid repository path");
	return { host: url.host, project, url: `https://${url.host}/${project}` };
}

export function pullRequestReference(value: string | undefined) {
	if (!value || /\s/.test(value)) return;
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return;
		const match = url.pathname.match(
			/^\/(.+?)(\/pull\/|\/-\/merge_requests\/)([1-9]\d*)\/?$/,
		);
		if (!match || !Number.isSafeInteger(Number(match[3]))) return;
		const repository = repositoryReference(`${url.origin}/${match[1]}`);
		const type =
			match[2] === "/pull/" ? ("github" as const) : ("gitlab" as const);
		if (type === "github" && repository.project.split("/").length !== 2) return;
		return { ...repository, type, number: Number(match[3]), requestUrl: value };
	} catch {
		return;
	}
}

/** GitHub owner/repository names are case-insensitive, including on Enterprise. */
export function sameRepositoryReference(
	type: "github" | "gitlab",
	expected: ReturnType<typeof repositoryReference>,
	actual: ReturnType<typeof repositoryReference>,
): boolean {
	return (
		expected.host === actual.host &&
		(type === "github"
			? expected.project.toLowerCase() === actual.project.toLowerCase()
			: expected.project === actual.project)
	);
}

export function samePullRequestReference(
	expected: string,
	actual: string | undefined,
): boolean {
	const left = pullRequestReference(expected);
	const right = pullRequestReference(actual);
	return Boolean(
		left &&
			right &&
			left.type === right.type &&
			left.number === right.number &&
			sameRepositoryReference(left.type, left, right),
	);
}

/** Other forge URLs are validated against the selected custom adapter at setup. */
export function isPullRequestSource(value: string | undefined): boolean {
	if (pullRequestReference(value)) return true;
	if (!value) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			url.hostname !== "linear.app" &&
			!/^\/p\/[^/]+\/t\//.test(url.pathname) &&
			(/\/(?:pulls?|pullrequests?|merge_requests|pull-requests)\/[1-9]\d*\/?$/.test(
				url.pathname,
			) ||
				/\/c\/.+\/\+\/\d+\/?$/.test(url.pathname))
		);
	} catch {
		return false;
	}
}
