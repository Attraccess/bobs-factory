import type { FastifyInstance } from "fastify";
import { handleCheckGh } from "./handlers/checkGh.js";
import { handleCheckGlab } from "./handlers/checkGlab.js";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleGitHubTokens } from "./handlers/githubTokens.js";
import {
	handleRepository,
	handleRepositoryDelete,
} from "./handlers/repository.js";
import {
	handleDeleteSkill,
	handleListSkills,
	handleUpdateSkill,
} from "./handlers/skills.js";
import { handleTestMcp } from "./handlers/testMcp.js";
import type {
	ApiResponse,
	CheckGhPayload,
	CheckGlabPayload,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	DeleteRepositoryPayload,
	DeleteSkillPayload,
	GitHubTokensPayload,
	ListSkillsPayload,
	RepositoryPayload,
	TestMcpPayload,
	UpdateSkillPayload,
} from "./types.js";

/**
 * ConfigUpdater registers configuration update routes with a Fastify server
 * Handles: cyrus-config, cyrus-env, repository, update/test-mcp, update/configure-mcp, check-gh endpoints
 *
 * `getApiKey` is invoked on every auth check, so callers reading from
 * `process.env.BOBS_FACTORY_API_KEY` pick up `.env` reloads (triggered by
 * `cyrus auth` after a credential rotation) without restarting the process.
 */
export class ConfigUpdater {
	private fastify: FastifyInstance;
	private factoryHome: string;
	private getApiKey: () => string;

	constructor(
		fastify: FastifyInstance,
		factoryHome: string,
		getApiKey: () => string,
		private readonly executeTransport: <T>(
			work: () => Promise<T>,
		) => Promise<T> = (work) => work(),
	) {
		this.fastify = fastify;
		this.factoryHome = factoryHome;
		this.getApiKey = getApiKey;
	}

	/**
	 * Register all configuration update routes with the Fastify instance
	 */
	register(): void {
		// Register all routes with authentication
		this.registerRoute(
			"/api/update/bobs-factory-config",
			this.handleCyrusConfigRoute,
		);
		this.registerRoute(
			"/api/update/bobs-factory-env",
			this.handleCyrusEnvRoute,
		);
		this.registerRoute("/api/update/repository", this.handleRepositoryRoute);
		this.registerDeleteRoute(
			"/api/update/repository",
			this.handleRepositoryDeleteRoute,
		);
		this.registerRoute("/api/update/test-mcp", this.handleTestMcpRoute);
		this.registerRoute(
			"/api/update/configure-mcp",
			this.handleConfigureMcpRoute,
		);
		this.registerRoute(
			"/api/update/github-tokens",
			this.handleGitHubTokensRoute,
		);
		this.registerRoute("/api/check-gh", this.handleCheckGhRoute);
		this.registerRoute("/api/check-glab", this.handleCheckGlabRoute);
		this.registerRoute("/api/update/skill", this.handleUpdateSkillRoute);
		this.registerDeleteRoute("/api/update/skill", this.handleDeleteSkillRoute);
		this.registerGetRoute("/api/skills", this.handleListSkillsRoute);
	}

	/**
	 * Register a route with authentication
	 */
	private registerRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.post(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}

			try {
				const response = await handler.call(this, request.body);
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	/**
	 * Register a DELETE route with authentication
	 */
	private registerDeleteRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.delete(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}

			try {
				const response = await handler.call(this, request.body);
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	/**
	 * Register a GET route with authentication
	 */
	private registerGetRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.get(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}

			try {
				const response = await handler.call(this, request.query || {});
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	/**
	 * Verify Bearer token authentication
	 */
	private verifyAuth(authHeader: string | undefined): boolean {
		const apiKey = this.getApiKey();
		if (!authHeader || !apiKey) {
			return false;
		}

		const expectedAuth = `Bearer ${apiKey}`;
		return authHeader === expectedAuth;
	}

	/**
	 * Handle cyrus-config update
	 */
	private async handleCyrusConfigRoute(
		payload: CyrusConfigPayload,
	): Promise<ApiResponse> {
		const response = await handleCyrusConfig(payload, this.factoryHome);

		// Emit restart event if requested
		if (response.success && response.data?.restartCyrus) {
			this.fastify.log.info("Config update requested Bob’s Factory restart");
		}

		return response;
	}

	/**
	 * Handle cyrus-env update
	 */
	private async handleCyrusEnvRoute(
		payload: CyrusEnvPayload,
	): Promise<ApiResponse> {
		const response = await handleCyrusEnv(payload, this.factoryHome);

		// Emit restart event if requested
		if (response.success && response.data?.restartCyrus) {
			this.fastify.log.info("Env update requested Bob’s Factory restart");
		}

		return response;
	}

	/**
	 * Handle repository clone/verify
	 */
	private async handleRepositoryRoute(
		payload: RepositoryPayload,
	): Promise<ApiResponse> {
		return handleRepository(payload, this.factoryHome);
	}

	/**
	 * Handle MCP connection test
	 */
	private async handleTestMcpRoute(
		payload: TestMcpPayload,
	): Promise<ApiResponse> {
		return this.executeTransport(() => handleTestMcp(payload));
	}

	/**
	 * Handle MCP server configuration
	 */
	private async handleConfigureMcpRoute(
		payload: ConfigureMcpPayload,
	): Promise<ApiResponse> {
		return handleConfigureMcp(payload, this.factoryHome);
	}

	/**
	 * Handle GitHub installation tokens push
	 */
	private async handleGitHubTokensRoute(
		payload: GitHubTokensPayload,
	): Promise<ApiResponse> {
		return handleGitHubTokens(payload, this.factoryHome);
	}

	/**
	 * Handle GitHub CLI check
	 */
	private async handleCheckGhRoute(
		payload: CheckGhPayload,
	): Promise<ApiResponse> {
		return handleCheckGh(payload, this.factoryHome);
	}

	/**
	 * Handle GitLab CLI check
	 */
	private async handleCheckGlabRoute(
		payload: CheckGlabPayload,
	): Promise<ApiResponse> {
		return handleCheckGlab(payload, this.factoryHome);
	}

	/**
	 * Handle repository deletion
	 */
	private async handleRepositoryDeleteRoute(
		payload: DeleteRepositoryPayload,
	): Promise<ApiResponse> {
		return handleRepositoryDelete(payload, this.factoryHome);
	}

	/**
	 * Handle creating or updating a user skill
	 */
	private async handleUpdateSkillRoute(
		payload: UpdateSkillPayload,
	): Promise<ApiResponse> {
		return handleUpdateSkill(payload, this.factoryHome);
	}

	/**
	 * Handle deleting a user skill
	 */
	private async handleDeleteSkillRoute(
		payload: DeleteSkillPayload,
	): Promise<ApiResponse> {
		return handleDeleteSkill(payload, this.factoryHome);
	}

	/**
	 * Handle listing user skills
	 */
	private async handleListSkillsRoute(
		payload: ListSkillsPayload,
	): Promise<ApiResponse> {
		return handleListSkills(payload, this.factoryHome);
	}
}
