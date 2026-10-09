/**
 * Linear-specific implementation of IIssueTrackerService.
 *
 * This adapter wraps the @linear/sdk LinearClient to provide a platform-agnostic
 * interface for issue tracking operations. It transforms Linear-specific types
 * to the platform-agnostic types defined in ../types.ts.
 *
 * @module issue-tracker/adapters/LinearIssueTrackerService
 */

import { createHash } from "node:crypto";
import { LinearDeliveryOutbox } from "./LinearDeliveryOutbox.js";
import { LinearRequestBudget } from "./LinearRequestBudget.js";

export interface LinearDeliveryOptions {
	workspaceId?: string;
	factoryHome?: string;
	requestIntervalMs?: number;
}

type LinearRequestBinding = {
	budget: LinearRequestBudget;
	workspaceId: string;
	intervalMs?: number;
};

import type { LinearClient } from "@linear/sdk";

/**
 * OAuth configuration for automatic token refresh.
 */
export interface LinearOAuthConfig {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	/** Workspace ID for coalescing concurrent refreshes across instances */
	workspaceId: string;
	/** Called when tokens are refreshed - use to persist new tokens */
	onTokenRefresh?: (tokens: {
		accessToken: string;
		refreshToken: string;
	}) => void | Promise<void>;
}

import type {
	AgentActivityCreateInput,
	AgentActivityPayload,
	AgentEventTransportConfig,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	Comment,
	CommentCreateInput,
	CommentWithAttachments,
	Connection,
	FetchChildrenOptions,
	FileUploadRequest,
	FileUploadResponse,
	IAgentEventTransport,
	IIssueTrackerService,
	Issue,
	IssueUpdateInput,
	IssueWithChildren,
	Label,
	PaginationOptions,
	Team,
	User,
	WorkflowState,
} from "bobs-factory-core";
import { createLogger, type ILogger } from "bobs-factory-core";
import { LinearEventTransport } from "./LinearEventTransport.js";

/**
 * Linear implementation of IIssueTrackerService.
 *
 * This class wraps the Linear SDK's LinearClient and provides a platform-agnostic
 * interface for all issue tracking operations. It handles type conversions between
 * Linear-specific types and platform-agnostic types.
 *
 * @example
 * ```typescript
 * const linearClient = new LinearClient({ accessToken: 'your-token' });
 * const service = new LinearIssueTrackerService(linearClient);
 *
 * // Fetch an issue
 * const issue = await service.fetchIssue('TEAM-123');
 *
 * // Create a comment
 * const comment = await service.createComment(issue.id, {
 *   body: 'This is a comment'
 * });
 * ```
 */
export class LinearIssueTrackerService implements IIssueTrackerService {
	private static budgetedClients = new WeakMap<
		LinearClient,
		LinearRequestBinding
	>();
	private readonly linearClient: LinearClient;
	private oauthConfig?: LinearOAuthConfig;
	private logger: ILogger;
	private refreshPromise: Promise<string> | null = null;
	private requestBinding?: LinearRequestBinding;
	private get requestBudget(): LinearRequestBudget | undefined {
		return this.requestBinding?.budget;
	}
	private activityDelivery?: LinearDeliveryOutbox<AgentActivityCreateInput>;
	private commentDelivery?: LinearDeliveryOutbox<{
		id?: string;
		issueId: string;
		body: string;
		parentId?: string;
	}>;

	/**
	 * Static map for workspace-level coalescing of concurrent token refreshes.
	 * Multiple instances sharing the same workspace will share a single refresh HTTP call.
	 */
	private static pendingRefreshes: Map<string, Promise<string>> = new Map();

	/**
	 * Static map storing the current refresh token per workspace.
	 * All instances sharing a workspace read/write from this shared state.
	 */
	private static workspaceRefreshTokens: Map<string, string> = new Map();

	/**
	 * Create a new LinearIssueTrackerService.
	 *
	 * @param linearClient - Configured LinearClient instance
	 * @param oauthConfig - Optional OAuth config for automatic token refresh on 401 errors
	 * @param logger - Optional logger instance
	 */
	constructor(
		linearClient: LinearClient,
		oauthConfig?: LinearOAuthConfig,
		logger?: ILogger,
		deliveryOptions: LinearDeliveryOptions = {},
	) {
		this.linearClient = linearClient;
		this.oauthConfig = oauthConfig;
		this.logger =
			logger ?? createLogger({ component: "LinearIssueTrackerService" });

		if (linearClient.client) {
			this.requestBinding =
				LinearIssueTrackerService.budgetedClients.get(linearClient);
			if (!this.requestBinding) {
				const workspaceId =
					deliveryOptions.workspaceId ?? oauthConfig?.workspaceId ?? "default";
				this.requestBinding = {
					budget: LinearRequestBudget.forClient(
						linearClient,
						workspaceId,
						deliveryOptions.requestIntervalMs,
					),
					workspaceId,
					intervalMs: deliveryOptions.requestIntervalMs,
				};
				LinearIssueTrackerService.budgetedClients.set(
					linearClient,
					this.requestBinding,
				);
				const binding = this.requestBinding;
				const request = linearClient.client.request.bind(linearClient.client);
				linearClient.client.request = (document, variables, headers) => {
					const input = (
						variables as
							| { input?: { body?: string; content?: { type?: string } } }
							| undefined
					)?.input;
					const priority =
						input?.body !== undefined ||
						["response", "elicitation", "error"].includes(
							input?.content?.type ?? "",
						)
							? 10
							: 0;
					// The SDK reads default headers when the queued operation executes.
					// Keep its credential paired with the budget selected at enqueue time.
					const capturedHeaders = {
						...headersRecord(linearClient.options?.headers),
						...headersRecord(headers),
					};
					return binding.budget.run(
						() => request(document, variables, capturedHeaders),
						priority,
					);
				};
			}
		}

		if (deliveryOptions.factoryHome)
			this.activityDelivery = LinearDeliveryOutbox.open(
				deliveryOptions.factoryHome,
				deliveryOptions.workspaceId ?? oauthConfig?.workspaceId ?? "default",
				this,
				async (input: AgentActivityCreateInput) => {
					const result = await this.linearClient.createAgentActivity(input);
					return { success: result.success, id: result.agentActivityId };
				},
				this.logger,
				async (input) => {
					try {
						const activity = await this.linearClient.agentActivity(input.id!);
						if (
							!activity ||
							activity.id !== input.id ||
							activity.agentSessionId !== input.agentSessionId ||
							Object.entries(input.content).some(
								([key, value]) =>
									JSON.stringify(
										(activity.content as unknown as Record<string, unknown>)[
											key
										],
									) !== JSON.stringify(value),
							)
						) {
							throw new Error(
								"Ambiguous Linear activity could not be reconciled; retaining delivery identity",
							);
						}
						return true;
					} catch (error) {
						if (confirmedMissingEntity(error, "AgentActivity")) return false;
						throw error; // Inconclusive lookup must never trigger another mutation.
					}
				},
				() => this.requestBudget?.retryAt ?? 0,
				"activity",
				(input) =>
					["response", "elicitation", "error"].includes(input.content?.type)
						? 10
						: 0,
				(input) => ["thought", "action"].includes(input.content?.type),
			);

		if (deliveryOptions.factoryHome)
			this.commentDelivery = LinearDeliveryOutbox.open(
				deliveryOptions.factoryHome,
				deliveryOptions.workspaceId ?? oauthConfig?.workspaceId ?? "default",
				this,
				async (input: {
					id?: string;
					issueId: string;
					body: string;
					parentId?: string;
				}) => {
					const result = await this.linearClient.createComment(input);
					return { success: result.success, id: result.commentId };
				},
				this.logger,
				async (input) => {
					try {
						const comment = await this.linearClient.comment({ id: input.id! });
						if (
							comment.id !== input.id ||
							comment.issueId !== input.issueId ||
							comment.body !== input.body ||
							comment.parentId !== input.parentId
						)
							throw new Error(
								"Ambiguous Linear comment could not be reconciled; retaining delivery identity",
							);
						return true;
					} catch (error) {
						if (confirmedMissingEntity(error, "Comment")) return false;
						throw error;
					}
				},
				() => this.requestBudget?.retryAt ?? 0,
				"comment",
				() => 10,
				() => false,
			);

		// Register initial refresh token in shared static map
		if (oauthConfig?.refreshToken) {
			LinearIssueTrackerService.workspaceRefreshTokens.set(
				oauthConfig.workspaceId,
				oauthConfig.refreshToken,
			);
		}

		// Only patch if oauthConfig is provided AND linearClient.client exists
		// (the .client property may not exist in test mocks)
		if (oauthConfig && linearClient.client) {
			const client = linearClient.client;
			const originalRequest = client.request.bind(client);

			// Track the current refresh promise - coalesces concurrent 401 errors.
			// Cleared when refresh fails or when setAccessToken() is called.

			client.request = async <Data, Variables extends Record<string, unknown>>(
				document: string,
				variables?: Variables,
				requestHeaders?: RequestInit["headers"],
				isRetry = false,
			): Promise<Data> => {
				try {
					return (await originalRequest(
						document,
						variables,
						requestHeaders,
					)) as Data;
				} catch (error) {
					// Don't retry if this is already a retry attempt (prevents infinite loops)
					// or if it's not a token expiration error
					if (isRetry || !this.isTokenExpiredError(error)) throw error;

					// Coalesce concurrent refresh attempts - everyone shares the same promise.
					if (!this.refreshPromise) {
						this.refreshPromise = this.doTokenRefresh().catch(
							(refreshError) => {
								// On failure, clear the promise so next 401 can retry fresh
								this.refreshPromise = null;
								this.logger.error("Token refresh failed:", refreshError);
								throw refreshError;
							},
						);
					}

					try {
						const newToken = await this.refreshPromise;
						// Clear cached promise so future token expirations trigger a fresh refresh.
						// Workspace-level coalescing via pendingRefreshes still deduplicates concurrent calls.
						this.refreshPromise = null;
						this.setAccessToken(newToken);

						// Retry the request with the new token (marked as retry to prevent loops)
						return (await (client.request as any)(
							document,
							variables,
							requestHeaders,
							true, // isRetry flag
						)) as Data;
					} catch (_refreshError) {
						// If refresh failed, throw the original 401 error for clarity
						throw error;
					}
				}
			};
		}
	}

	/**
	 * Performs the OAuth token refresh with workspace-level coalescing.
	 * Multiple concurrent refresh requests for the same workspace share a single HTTP call.
	 * @returns The new access token
	 */
	private async doTokenRefresh(): Promise<string> {
		if (!this.oauthConfig) {
			throw new Error("OAuth config not provided");
		}

		const { workspaceId } = this.oauthConfig;

		// Check if there's already a pending refresh for this workspace
		const pendingRefresh =
			LinearIssueTrackerService.pendingRefreshes.get(workspaceId);
		if (pendingRefresh) {
			this.logger.info(`Coalescing token refresh for workspace ${workspaceId}`);
			return pendingRefresh;
		}

		// Create the refresh promise and store it
		const refreshPromise = this.executeTokenRefresh();
		LinearIssueTrackerService.pendingRefreshes.set(workspaceId, refreshPromise);

		try {
			return await refreshPromise;
		} finally {
			// One of the key guarantees of finally — it runs regardless of how the try block exits (return, throw, or normal completion).
			LinearIssueTrackerService.pendingRefreshes.delete(workspaceId);
		}
	}

	/**
	 * Executes the actual OAuth token refresh HTTP request.
	 * @internal
	 */
	private async executeTokenRefresh(): Promise<string> {
		const { clientId, clientSecret, workspaceId, onTokenRefresh } =
			this.oauthConfig!;

		// Read current refresh token from shared static map (may have been updated by another instance)
		const refreshToken =
			LinearIssueTrackerService.workspaceRefreshTokens.get(workspaceId);
		if (!refreshToken) {
			throw new Error(
				`No refresh token available for workspace ${workspaceId}`,
			);
		}

		this.logger.info(`Refreshing token for workspace ${workspaceId}...`);

		const params = new URLSearchParams({
			grant_type: "refresh_token",
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
		});

		// https://linear.app/developers/oauth-2-0-authentication
		const response = await fetch("https://api.linear.app/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params.toString(),
		});

		if (!response.ok) {
			throw new Error(`Token refresh failed: ${response.status}`);
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		// Update shared static map for all instances sharing this workspace
		LinearIssueTrackerService.workspaceRefreshTokens.set(
			workspaceId,
			data.refresh_token,
		);

		// Notify caller so they can persist tokens to disk
		if (onTokenRefresh) {
			try {
				await onTokenRefresh({
					accessToken: data.access_token,
					refreshToken: data.refresh_token,
				});
			} catch (err) {
				this.logger.error("onTokenRefresh callback failed:", err);
			}
		}

		this.logger.info(
			`Token refreshed successfully for workspace ${workspaceId}`,
		);
		return data.access_token;
	}

	/**
	 * Check if an error is a 401 token expiration error.
	 */
	private isTokenExpiredError(error: unknown): boolean {
		const err = error as { status?: number; response?: { status?: number } };
		return err?.status === 401 || err?.response?.status === 401;
	}

	/**
	 * Update the access token using setHeader on the underlying GraphQL client.
	 * This is more efficient than recreating the entire LinearClient.
	 * @param token - New access token
	 */
	setAccessToken(token: string): void {
		// Clear any cached refresh promise so subsequent 401s trigger a fresh refresh
		// rather than reusing a stale resolved promise with an old token.
		this.refreshPromise = null;
		// Guard for test mocks that may not have the .client property
		if (this.linearClient.client) {
			this.linearClient.client.setHeader("Authorization", `Bearer ${token}`);
			if (this.requestBinding) {
				this.requestBinding.budget = LinearRequestBudget.forClient(
					this.linearClient,
					this.requestBinding.workspaceId,
					this.requestBinding.intervalMs,
				);
			}
		}
	}

	/**
	 * Get the underlying LinearClient instance.
	 * Useful when callers need the same client with its OAuth refresh interceptor.
	 */
	getClient(): LinearClient {
		return this.linearClient;
	}

	// ========================================================================
	// ISSUE OPERATIONS
	// ========================================================================

	/**
	 * Fetch a single issue by ID or identifier.
	 */
	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		return await this.linearClient.issue(idOrIdentifier);
	}

	/**
	 * Fetch child issues (sub-issues) for a parent issue.
	 */
	async fetchIssueChildren(
		issueId: string,
		options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		try {
			const parentIssue = await this.linearClient.issue(issueId);

			// Build filter based on options
			const filter: Record<string, unknown> = {};

			if (options?.includeCompleted === false) {
				filter.state = { type: { neq: "completed" } };
			}

			if (options?.includeArchived === false) {
				filter.archivedAt = { null: true };
			}

			// Merge with additional filters
			if (options?.filter) {
				Object.assign(filter, options.filter);
			}

			// Fetch children with filter
			const childrenConnection = await parentIssue.children({
				first: options?.limit ?? 50,
				filter,
			});

			const children = childrenConnection.nodes ?? [];

			// Return issue with children array directly from Linear SDK
			// Cast to IssueWithChildren since Linear SDK types are compatible
			return Object.assign(parentIssue, {
				children,
				childCount: children.length,
			}) as IssueWithChildren;
		} catch (error) {
			const err = new Error(
				`Failed to fetch children for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Update an issue's properties.
	 */
	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		try {
			const updatePayload = await this.linearClient.updateIssue(
				issueId,
				updates,
			);

			if (!updatePayload.success) {
				throw new Error("Linear API returned success=false");
			}

			// Fetch the updated issue
			const updatedIssue = await updatePayload.issue;
			if (!updatedIssue) {
				throw new Error("Updated issue not returned from Linear API");
			}

			return updatedIssue;
		} catch (error) {
			const err = new Error(
				`Failed to update issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Fetch attachments for an issue.
	 *
	 * Uses the Linear SDK to fetch native attachments (typically external links
	 * to Sentry errors, Datadog reports, etc.)
	 */
	async linkPullRequest(
		issueId: string,
		url: string,
		title: string,
	): Promise<void> {
		const result = await this.linearClient.createAttachment({
			issueId,
			url,
			title,
		});
		if (!result.success)
			throw new Error(`Failed to attach PR to issue ${issueId}`);
	}

	async fetchIssueAttachments(
		issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		try {
			const issue = await this.linearClient.issue(issueId);

			if (!issue) {
				throw new Error(`Issue ${issueId} not found`);
			}

			const attachments: Array<{ title: string; url: string }> = [];
			const cursors = new Set<string>();
			let after: string | undefined;
			do {
				const page = await issue.attachments({
					first: 100,
					...(after ? { after } : {}),
				});
				attachments.push(
					...page.nodes.map((attachment) => ({
						title: attachment.title || "Untitled attachment",
						url: attachment.url,
					})),
				);
				if (!page.pageInfo?.hasNextPage) break;
				const cursor = page.pageInfo.endCursor;
				if (!cursor || cursors.has(cursor))
					throw new Error("Ticket attachment pagination did not advance");
				cursors.add(cursor);
				after = cursor;
			} while (after);
			return attachments;
		} catch (error) {
			const err = new Error(
				`Failed to fetch attachments for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	// ========================================================================
	// COMMENT OPERATIONS
	// ========================================================================

	/**
	 * Fetch comments for an issue with optional pagination.
	 */
	async fetchComments(
		issueId: string,
		options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		try {
			const issue = await this.linearClient.issue(issueId);
			const commentsConnection = await issue.comments({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: commentsConnection.nodes ?? [],
				pageInfo: commentsConnection.pageInfo
					? {
							hasNextPage: commentsConnection.pageInfo.hasNextPage,
							hasPreviousPage: commentsConnection.pageInfo.hasPreviousPage,
							startCursor: commentsConnection.pageInfo.startCursor,
							endCursor: commentsConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			const err = new Error(
				`Failed to fetch comments for issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Fetch a single comment by ID.
	 */
	async fetchComment(commentId: string): Promise<Comment> {
		return await this.linearClient.comment({ id: commentId });
	}

	/**
	 * Fetch a comment with attachments.
	 *
	 * @param commentId - Comment ID to fetch
	 * @returns Promise resolving to comment with attachments
	 * @throws Error if comment not found or request fails
	 *
	 * @remarks
	 * **LIMITATION**: This method currently returns an empty `attachments` array
	 * because Linear's GraphQL API does not expose comment attachment metadata
	 * through their SDK or documented API endpoints.
	 *
	 * This is expected behavior, not a bug. Issue attachments (via `fetchIssueAttachments`)
	 * work correctly - only comment attachments are unavailable from the Linear API.
	 *
	 * If you need comment attachments, consider:
	 * - Using issue attachments instead (`fetchIssueAttachments`)
	 * - Parsing attachment URLs from comment body markdown
	 * - Waiting for Linear to expose this data in their API
	 *
	 * Implementation detail: The returned comment object is a Linear SDK Comment
	 * with an empty `attachments` array property added.
	 */
	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		try {
			// Fetch the comment using the Linear SDK
			const comment = await this.fetchComment(commentId);

			// Return comment with empty attachments array (Linear API doesn't expose comment attachments)
			// Cast to CommentWithAttachments since Linear SDK types are compatible
			return Object.assign(comment, {
				attachments: [],
			}) as CommentWithAttachments;
		} catch (error) {
			const err = new Error(
				`Failed to fetch comment with attachments ${commentId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Create a comment on an issue.
	 */
	async createComment(
		issueId: string,
		input: CommentCreateInput,
	): Promise<Comment> {
		try {
			// Build the comment body, optionally appending attachment URLs
			let finalBody = input.body;

			// If attachment URLs are provided, append them to the comment body as markdown
			if (input.attachmentUrls && input.attachmentUrls.length > 0) {
				const attachmentMarkdown = input.attachmentUrls
					.map((url) => {
						// Detect if the URL is an image based on file extension
						// Matches common image extensions followed by query params (?), fragments (#), or end of string ($)
						// Examples: image.png, image.png?v=123, image.png#section, image.png?w=500&h=300
						const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp)(\?|#|$)/i.test(
							url,
						);
						if (isImage) {
							// Embed as markdown image
							return `![attachment](${url})`;
						}
						// Otherwise, embed as markdown link
						return `[attachment](${url})`;
					})
					.join("\n");

				// Append attachments to the body with a separator if body is not empty
				finalBody = input.body
					? `${input.body}\n\n${attachmentMarkdown}`
					: attachmentMarkdown;
			}

			if (this.commentDelivery) {
				const id = documentationId(issueId, finalBody, input.parentId);
				await this.commentDelivery.post({
					id,
					issueId,
					body: finalBody,
					...(input.parentId ? { parentId: input.parentId } : {}),
				});
				return this.fetchComment(id);
			}

			const createPayload = await this.linearClient.createComment({
				issueId,
				body: finalBody,
				parentId: input.parentId,
			});

			if (!createPayload.success) {
				throw new Error("Linear API returned success=false");
			}

			const createdComment = await createPayload.comment;
			if (!createdComment) {
				throw new Error("Created comment not returned from Linear API");
			}

			return createdComment;
		} catch (error) {
			const err = new Error(
				`Failed to create comment on issue ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	// ========================================================================
	// TEAM OPERATIONS
	// ========================================================================

	/**
	 * Fetch all teams in the workspace/organization.
	 */
	async fetchTeams(options?: PaginationOptions): Promise<Connection<Team>> {
		try {
			const teamsConnection = await this.linearClient.teams({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: teamsConnection.nodes ?? [],
				pageInfo: teamsConnection.pageInfo
					? {
							hasNextPage: teamsConnection.pageInfo.hasNextPage,
							hasPreviousPage: teamsConnection.pageInfo.hasPreviousPage,
							startCursor: teamsConnection.pageInfo.startCursor,
							endCursor: teamsConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			const err = new Error(
				`Failed to fetch teams: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Fetch a single team by ID or key.
	 */
	async fetchTeam(idOrKey: string): Promise<Team> {
		return await this.linearClient.team(idOrKey);
	}

	// ========================================================================
	// LABEL OPERATIONS
	// ========================================================================

	/**
	 * Fetch all issue labels in the workspace/organization.
	 */
	async fetchLabels(options?: PaginationOptions): Promise<Connection<Label>> {
		try {
			const labelsConnection = await this.linearClient.issueLabels({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: labelsConnection.nodes ?? [],
				pageInfo: labelsConnection.pageInfo
					? {
							hasNextPage: labelsConnection.pageInfo.hasNextPage,
							hasPreviousPage: labelsConnection.pageInfo.hasPreviousPage,
							startCursor: labelsConnection.pageInfo.startCursor,
							endCursor: labelsConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			const err = new Error(
				`Failed to fetch labels: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Fetch a single label by ID or name.
	 */
	async fetchLabel(idOrName: string): Promise<Label> {
		return await this.linearClient.issueLabel(idOrName);
	}

	/**
	 * Fetch label names for a specific issue.
	 */
	async getIssueLabels(issueId: string): Promise<string[]> {
		try {
			const issue = await this.linearClient.issue(issueId);
			const labels = await issue.labels();
			return labels.nodes.map((label) => label.name);
		} catch (error) {
			const err = new Error(
				`Failed to fetch issue labels for ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	// ========================================================================
	// WORKFLOW STATE OPERATIONS
	// ========================================================================

	/**
	 * Fetch workflow states for a team.
	 */
	async fetchWorkflowStates(
		teamId: string,
		options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		try {
			const team = await this.linearClient.team(teamId);
			const statesConnection = await team.states({
				first: options?.first ?? 50,
				after: options?.after,
				before: options?.before,
			});

			return {
				nodes: statesConnection.nodes ?? [],
				pageInfo: statesConnection.pageInfo
					? {
							hasNextPage: statesConnection.pageInfo.hasNextPage,
							hasPreviousPage: statesConnection.pageInfo.hasPreviousPage,
							startCursor: statesConnection.pageInfo.startCursor,
							endCursor: statesConnection.pageInfo.endCursor,
						}
					: undefined,
			};
		} catch (error) {
			const err = new Error(
				`Failed to fetch workflow states for team ${teamId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	/**
	 * Fetch a single workflow state by ID.
	 */
	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		return await this.linearClient.workflowState(stateId);
	}

	// ========================================================================
	// USER OPERATIONS
	// ========================================================================

	/**
	 * Fetch a user by ID.
	 */
	async fetchUser(userId: string): Promise<User> {
		return await this.linearClient.user(userId);
	}

	/**
	 * Fetch the current authenticated user.
	 */
	async fetchCurrentUser(): Promise<User> {
		return await this.linearClient.viewer;
	}

	// ========================================================================
	// AGENT SESSION OPERATIONS
	// ========================================================================

	/**
	 * Create an agent session on an issue.
	 * Uses native SDK method - direct passthrough to Linear SDK.
	 */
	createAgentSessionOnIssue(input: AgentSessionCreateOnIssueInput) {
		return this.linearClient.agentSessionCreateOnIssue(input);
	}

	/**
	 * Create an agent session on a comment thread.
	 * Uses native SDK method - direct passthrough to Linear SDK.
	 */
	createAgentSessionOnComment(input: AgentSessionCreateOnCommentInput) {
		return this.linearClient.agentSessionCreateOnComment(input);
	}

	/**
	 * Fetch an agent session by ID.
	 * Uses native SDK method - direct passthrough to Linear SDK.
	 */
	fetchAgentSession(sessionId: string) {
		return this.linearClient.agentSession(sessionId);
	}

	async findAgentSessionForExternalLink(
		issueId: string,
		externalLink: string,
	): Promise<string | undefined> {
		const matches: string[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
			const page = await this.linearClient.agentSessions({
				first: 100,
				...(after ? { after } : {}),
			});
			matches.push(
				...page.nodes
					.filter(
						(session) =>
							session.issueId === issueId &&
							session.externalLink === externalLink,
					)
					.map((session) => session.id),
			);
			if (matches.length > 1)
				throw new Error(
					"Multiple Linear transcript sessions match this run; reassess their binding before delivery",
				);
			if (!page.pageInfo.hasNextPage) return matches[0];
			after = page.pageInfo.endCursor;
			if (!after || cursors.has(after))
				throw new Error(
					"Linear transcript reconciliation pagination did not advance",
				);
			cursors.add(after);
		}
		throw new Error(
			"Linear transcript reconciliation exceeded 100 pages; retain pending creation for operator review",
		);
	}

	/**
	 * Emit a stop signal webhook event.
	 * No-op for Linear - stop signals come from Linear webhooks, not from us.
	 */
	async emitStopSignalEvent(_sessionId: string): Promise<void> {
		// No-op for Linear implementation - stop signals are handled via Linear webhooks
	}

	// ========================================================================
	// AGENT ACTIVITY OPERATIONS
	// ========================================================================

	/**
	 * Post an agent activity to an agent session.
	 * Signature matches Linear SDK's createAgentActivity exactly.
	 */
	async createAgentActivity(
		input: AgentActivityCreateInput,
		options?: { operational?: boolean },
	): Promise<AgentActivityPayload> {
		if (!this.activityDelivery)
			return this.linearClient.createAgentActivity(input);
		const receipt = await this.activityDelivery.post(
			input,
			options?.operational,
		);
		return {
			success: receipt.success,
			agentActivityId: receipt.id,
		} as AgentActivityPayload;
	}

	/** Delivery recovery never resumes development or replays a completed role. */
	startDelivery(): void {
		this.activityDelivery?.start(this);
		this.commentDelivery?.start(this);
	}
	stopDelivery(): void {
		this.activityDelivery?.stop(this);
		this.commentDelivery?.stop(this);
	}
	flushActivityDelivery(): Promise<void> {
		return Promise.all([
			this.activityDelivery?.flush(),
			this.commentDelivery?.flush(),
		]).then(() => {});
	}
	getActivityDeliveryStatus() {
		const statuses = [
			this.activityDelivery?.status(),
			this.commentDelivery?.status(),
		].filter((value) => value !== undefined);
		return {
			pending: statuses.reduce((n, s) => n + s.pending, 0),
			delivered: statuses.reduce((n, s) => n + s.delivered, 0),
			superseded: statuses.reduce((n, s) => n + s.superseded, 0),
			error: statuses.find((s) => s.error)?.error,
			nextAttemptAt: statuses
				.map((s) => s.nextAttemptAt)
				.filter((at): at is number => at !== undefined)
				.sort((a, b) => a - b)[0],
		};
	}

	// ========================================================================
	// FILE OPERATIONS
	// ========================================================================

	/**
	 * Request a file upload URL from the platform.
	 */
	async requestFileUpload(
		request: FileUploadRequest,
	): Promise<FileUploadResponse> {
		try {
			const uploadPayload = await this.linearClient.fileUpload(
				request.contentType,
				request.filename,
				request.size,
				{
					makePublic: request.makePublic ?? false,
				},
			);

			if (!uploadPayload.success) {
				throw new Error("Linear API returned success=false");
			}

			// Access the upload file result
			const uploadFile = await uploadPayload.uploadFile;
			if (!uploadFile) {
				throw new Error("Upload file not returned from Linear API");
			}

			// Convert headers array to record
			const headersRecord: Record<string, string> = {};
			if (uploadFile.headers) {
				for (const header of uploadFile.headers) {
					if (header.key && header.value) {
						headersRecord[header.key] = header.value;
					}
				}
			}

			return {
				uploadUrl: uploadFile.uploadUrl ?? "",
				headers: headersRecord,
				assetUrl: uploadFile.assetUrl ?? "",
			};
		} catch (error) {
			const err = new Error(
				`Failed to request file upload for ${request.filename}: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (error instanceof Error) {
				err.cause = error;
			}
			throw err;
		}
	}

	// ========================================================================
	// PLATFORM METADATA
	// ========================================================================

	/**
	 * Get the platform type identifier.
	 */
	getPlatformType(): string {
		return "linear";
	}

	/**
	 * Get the platform's API version or other metadata.
	 */
	getPlatformMetadata(): Record<string, unknown> {
		return {
			platform: "linear",
			sdkVersion: "unknown", // LinearClient doesn't expose version
			apiVersion: "graphql",
		};
	}

	// ========================================================================
	// EVENT TRANSPORT
	// ========================================================================

	/**
	 * Create an event transport for receiving Linear webhook events.
	 *
	 * @param config - Transport configuration
	 * @returns Linear event transport implementation
	 */
	createEventTransport(
		config: AgentEventTransportConfig,
	): IAgentEventTransport {
		// Type narrow to Linear config
		if (config.platform !== "linear") {
			throw new Error(
				`Invalid platform "${config.platform}" for LinearIssueTrackerService. Expected "linear".`,
			);
		}

		// Import from same package - no require() needed
		return new LinearEventTransport(config);
	}
}

function headersRecord(
	headers?: RequestInit["headers"],
): Record<string, string | readonly string[]> {
	if (headers instanceof Headers) return Object.fromEntries(headers.entries());
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return { ...headers };
}

function confirmedMissingEntity(error: unknown, entity: string): boolean {
	type Response = {
		errors?: { message?: string; extensions?: { code?: string } }[];
	};
	type WrappedError = {
		status?: number;
		response?: Response;
		raw?: WrappedError;
	};
	const seen = new Set<unknown>();
	for (let raw = error as WrappedError; raw && !seen.has(raw); raw = raw.raw!) {
		seen.add(raw);
		if (
			raw.status === 404 ||
			raw.response?.errors?.some(
				(e) =>
					["ENTITY_NOT_FOUND", "NOT_FOUND"].includes(
						e.extensions?.code ?? "",
					) ||
					(e.extensions?.code === "INPUT_ERROR" &&
						e.message === `Entity not found: ${entity}`),
			)
		)
			return true;
	}
	return false;
}

/** Repeated durable documentation retains one identity; markers distinguish separate workflow events. */
function documentationId(
	issueId: string,
	body: string,
	parentId?: string,
): string {
	const bytes = createHash("sha256")
		.update(JSON.stringify([issueId, body, parentId ?? null]))
		.digest()
		.subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x40;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
