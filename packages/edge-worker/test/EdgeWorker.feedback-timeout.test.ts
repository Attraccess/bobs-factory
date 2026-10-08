import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "bobs-factory-claude-runner";
import { LinearEventTransport } from "bobs-factory-linear-event-transport";
import { createCyrusToolsServer } from "bobs-factory-mcp-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { TEST_BOBS_FACTORY_HOME } from "./test-dirs.js";

// Mock all dependencies
vi.mock("fs/promises");
vi.mock("bobs-factory-claude-runner");
vi.mock("bobs-factory-mcp-tools");
vi.mock("bobs-factory-codex-runner");
vi.mock("bobs-factory-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("bobs-factory-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(function () {
			return {
				loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
				saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
			};
		}),
	};
});

describe("EdgeWorker - Feedback Delivery Timeout Issue", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockAgentSessionManager: any;
	let mockChildAgentSessionManager: any;
	let mockClaudeRunner: any;
	let resumeClaudeSessionSpy: any;
	let mockOnFeedbackDelivery: any;
	let _mockOnSessionCreated: any;

	const releaseSessions: (() => void)[] = [];
	function pendingSession() {
		let release!: () => void;
		const promise = new Promise<void>((resolve) => {
			release = resolve;
		});
		releaseSessions.push(release);
		return { promise, release };
	}

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read", "Edit"],
		labelPrompts: {},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});

		// Setup callbacks to be captured
		mockOnFeedbackDelivery = vi.fn();
		_mockOnSessionCreated = vi.fn();

		// Mock createCyrusToolsServer to return a proper structure
		vi.mocked(createCyrusToolsServer).mockImplementation((_client, options) => {
			// Capture the callbacks
			if (options?.onFeedbackDelivery) {
				mockOnFeedbackDelivery = options.onFeedbackDelivery;
			}
			if (options?.onSessionCreated) {
				_mockOnSessionCreated = options.onSessionCreated;
			}

			// Return a mock MCP server shape
			return {
				server: {},
			} as any;
		});

		// Mock ClaudeRunner with a long-running session to simulate the timeout
		mockClaudeRunner = {
			supportsStreamingInput: true,
			startStreaming: vi.fn().mockImplementation(async () => {
				// Keep completion controlled, independently of host scheduling delays.
				await pendingSession().promise;
				return { sessionId: "claude-session-123" };
			}),
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(false),
		};
		vi.mocked(ClaudeRunner).mockImplementation(function () {
			return mockClaudeRunner;
		});

		// Mock child session manager
		mockChildAgentSessionManager = {
			hasAgentRunner: vi.fn().mockReturnValue(true),
			getSession: vi.fn().mockReturnValue({
				issueId: "CHILD-456",
				claudeSessionId: "child-claude-session-456",
				workspace: { path: "/test/workspaces/CHILD-456" },
				claudeRunner: mockClaudeRunner,
			}),
			getAgentRunner: vi.fn().mockReturnValue(mockClaudeRunner),
			postAnalyzingThought: vi.fn().mockResolvedValue(undefined),
			createThoughtActivity: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(), // EventEmitter method
		};

		// Mock parent session manager (for different repository)
		mockAgentSessionManager = {
			hasAgentRunner: vi.fn().mockReturnValue(false),
			getSession: vi.fn().mockReturnValue(null),
			on: vi.fn(), // EventEmitter method
		};

		// Mock AgentSessionManager constructor
		vi.mocked(AgentSessionManager).mockImplementation(function (
			_linearClient,
			..._args
		) {
			// Return different managers based on some condition
			// In real usage, these would be created per repository
			return mockAgentSessionManager;
		});

		// Mock other dependencies
		vi.mocked(SharedApplicationServer).mockImplementation(function () {
			return {
				start: vi.fn().mockResolvedValue(undefined),
				stop: vi.fn().mockResolvedValue(undefined),
				getFastifyInstance: vi.fn().mockReturnValue({ post: vi.fn() }),
				getWebhookUrl: vi.fn().mockReturnValue("http://localhost:3456/webhook"),
				registerOAuthCallbackHandler: vi.fn(),
			};
		} as any);

		vi.mocked(LinearEventTransport).mockImplementation(function () {
			return {
				register: vi.fn(),
				on: vi.fn(),
				removeAllListeners: vi.fn(),
			};
		} as any);

		vi.mocked(LinearClient).mockImplementation(function () {
			return {
				users: {
					me: vi.fn().mockResolvedValue({
						id: "user-123",
						name: "Test User",
					}),
				},
			};
		} as any);

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			factoryHome: TEST_BOBS_FACTORY_HOME,
			repositories: [mockRepository],
			linearWorkspaces: {
				"test-workspace": { linearToken: "test-token" },
			},
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/CHILD-456",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Setup parent-child mapping in GlobalSessionRegistry (single source of truth)
		(edgeWorker as any).globalSessionRegistry.setParentSession(
			"child-session-456",
			"parent-session-123",
		);

		// Setup single agent session manager and session-to-repo mapping
		(edgeWorker as any).agentSessionManager = mockChildAgentSessionManager;
		(edgeWorker as any).sessionRepositories.set(
			"child-session-456",
			"test-repo",
		);
		(edgeWorker as any).repositories.set("test-repo", mockRepository);

		// Inject mock issue tracker for the test workspace
		(edgeWorker as any).issueTrackers.set(mockRepository.linearWorkspaceId, {
			fetchIssue: vi.fn(),
			getIssueLabels: vi.fn().mockResolvedValue([]),
			getClient: vi.fn().mockReturnValue({}),
		});
	});

	afterEach(() => {
		for (const release of releaseSessions.splice(0)) release();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("Feedback Delivery Timeout Fix", () => {
		it("FIXED: should return immediately without waiting for child session to complete", async () => {
			// This test verifies the fix: feedback delivery returns immediately
			// without waiting for the child session to complete

			// Arrange
			const childSessionId = "child-session-456";
			const feedbackMessage =
				"Please revise your approach and focus on the error handling";

			// Use the real implementation without mocking resumeAgentSession
			// to test the actual fire-and-forget behavior
			resumeClaudeSessionSpy = vi
				.spyOn(edgeWorker as any, "resumeAgentSession")
				.mockImplementation(async () => {
					// Simulate a long-running session
					await mockClaudeRunner.startStreaming();
					return undefined;
				});

			// Build MCP config which will trigger createCyrusToolsServer
			const _mcpConfig = (edgeWorker as any).mcpConfigService.buildMcpConfig(
				mockRepository.id,
				mockRepository.linearWorkspaceId,
				"parent-session-123",
			);

			// Returning while the child remains pending proves delivery does not await it.
			const result = await mockOnFeedbackDelivery(
				childSessionId,
				feedbackMessage,
			);

			// Assert - The feedback delivery should return quickly
			expect(result).toBe(true);

			await vi.waitFor(() => {
				expect(resumeClaudeSessionSpy).toHaveBeenCalledOnce();
				expect(mockClaudeRunner.startStreaming).toHaveBeenCalledOnce();
			});

			// The child session is still running in the background
			expect(mockClaudeRunner.startStreaming).toHaveBeenCalledOnce();
		}); // Regular timeout since it should return quickly

		it("should verify feedback initiates session but doesn't block on completion", async () => {
			// This test verifies the fire-and-forget behavior

			// Arrange
			const childSessionId = "child-session-456";
			const feedbackMessage = "Test feedback";
			let sessionCompleted = false;
			const child = pendingSession();

			// Mock resumeAgentSession to track when it completes
			resumeClaudeSessionSpy = vi
				.spyOn(edgeWorker as any, "resumeAgentSession")
				.mockImplementation(async () => {
					await child.promise;
					sessionCompleted = true;
					return undefined;
				});

			// Build MCP config
			const _mcpConfig = (edgeWorker as any).mcpConfigService.buildMcpConfig(
				mockRepository.id,
				mockRepository.linearWorkspaceId,
				"parent-session-123",
			);

			// Act
			const result = await mockOnFeedbackDelivery(
				childSessionId,
				feedbackMessage,
			);

			// Assert
			expect(result).toBe(true);
			expect(sessionCompleted).toBe(false); // Session still running

			await vi.waitFor(() =>
				expect(resumeClaudeSessionSpy).toHaveBeenCalledOnce(),
			);

			child.release();
			await resumeClaudeSessionSpy.mock.results[0].value;
			expect(sessionCompleted).toBe(true);
		}, 5000);
	});
});
