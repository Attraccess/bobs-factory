/** Save reply routing context without copying webhook-supplied credentials into
 * session records (which also appear in the dashboard). Recovery uses live
 * platform credentials rather than expired event credentials. */
export function persistReplyEvent(event: unknown): unknown {
	if (!event || typeof event !== "object") return event;
	const {
		slackBotToken: _slack,
		installationToken: _github,
		accessToken: _gitlab,
		credentials: _zulip,
		token: _legacy,
		...context
	} = event as Record<string, unknown>;
	return context;
}
