/**
 * Prompt Assembly Tests - Routing Context Generation
 *
 * Tests the routing context generation for orchestrator multi-repository scenarios.
 *
 * IMPORTANT: These tests assert the ENTIRE prompt, not partial checks with .toContain().
 * This ensures comprehensive test coverage and catches regressions in prompt structure.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Routing Context", () => {
	it("should not include routing context for single-repository setup", async () => {
		const repository = {
			id: "repo-single-123",
			name: "Single Repo",
			repositoryPath: "/test/single-repo",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/single-repo",
			routingLabels: ["backend"],
			teamKeys: ["BACK"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([repository]);

		const session = {
			issueId: "issue-123",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-123",
			identifier: "BACK-100",
			title: "Single repo orchestration",
			description: "Test issue",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Orchestrate this task")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Single Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-123</id>
<identifier>BACK-100</identifier>
<title>Single repo orchestration</title>
<description>Test issue</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Orchestrate this task
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should include routing context for multi-repository setup", async () => {
		const frontendRepo = {
			id: "repo-frontend-123",
			name: "Frontend App",
			repositoryPath: "/test/frontend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/myorg/frontend-app",
			routingLabels: ["frontend", "ui"],
			teamKeys: ["FE"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const backendRepo = {
			id: "repo-backend-456",
			name: "Backend API",
			repositoryPath: "/test/backend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/myorg/backend-api",
			routingLabels: ["backend", "api"],
			teamKeys: ["BE"],
			projectKeys: ["API Project"],
		};

		const worker = createTestWorker([frontendRepo, backendRepo]);

		const session = {
			issueId: "issue-456",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-456",
			identifier: "FE-200",
			title: "Cross-repo feature",
			description: "Add feature spanning frontend and backend",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(frontendRepo)
			.withUserComment("Orchestrate this cross-repo feature")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Frontend App</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-456</id>
<identifier>FE-200</identifier>
<title>Cross-repo feature</title>
<description>Add feature spanning frontend and backend</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<repository_routing_context>
<description>
When creating sub-issues that should be handled in a DIFFERENT repository, use one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=repo-name]\` to the sub-issue description.
   - Multiple repos: \`[repo=repo1]\` and \`[repo=repo2]\`, or \`repos=repo1,repo2\`
   - Base branch override: \`[repo=repo-name#branch-name]\` to target a specific branch instead of the default
   - Unbracketed syntax also works: \`repo=repo-name\` or \`repo=repo-name#branch\`
   - Agent selector: \`[agent=claude|gemini|codex|cursor|opencode]\` to choose the execution harness
   - Linear label selector: \`<provider>/<model>\` (for example \`openai/gpt-5.5\`) to choose both harness and model. For OpenCode, use \`opencode/<provider>/<model>\` (for example \`opencode/openai/gpt-5.5\`).
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.

Current workflow launch behavior (capability reference): Factory manual launches accept an originating Linear or Taskbot ticket URL as the prompt or explicit ticket source. The runtime fetches complete ticket context, retains verified tracker identity through roles and follow-ups, and owns lifecycle comments and PR links. Coding tickets stay nonterminal during work, In Review awaiting human/provider action, and Done only after provider-confirmed merge. Ticket synchronization failures remain visible in run activity and ticketSync receipts; retry only tracking through POST /api/runs/:id/ticket-sync after restoring access or reassessing conflicts. Simple retains its native tracking lifecycle. Factory supports opt-in Web Push through Notifications for new questions, review revisions, human-only blockers, failures needing help and successful completions. Enable and test each browser device explicitly; remote disable never auto-enables. VAPID subscriptions and consumed transition receipts survive restart. Only fresh transitions are attempted, with TTL zero and no replay after enablement, outage or recovery; provider acceptance does not prove display. Notification text is minimal; clicks refresh protected run/review state before actions. Configure CYRUS_FACTORY_PUSH_SUBJECT and, for the trusted HTTPS proxy, the exact CYRUS_FACTORY_ORIGIN; physical-device background delivery remains unverified. Workflow selection is separate from repository routing. Stock workflow labels are workflow:factory (or factory), workflow:takeover (or takeover), and workflow:simple; operators can customize labels in Recipes. New launches select an explicit manual UI/API workflow choice, then [workflow=<id>] in the original triggering comment, then the issue description, then the first matching workflow in configured label order, then the single saved default. Escaped brackets are supported. Quoted text and code examples are ignored; repeated identical selectors are valid, but malformed or conflicting selectors in the winning source reject without fallback. Higher-priority sources override lower-source conflicts. New mention-created sessions on an active issue reject temporarily pending #36; reply to the existing session for steering or answers. The selected workflow must allow ticket-assignment for assignments or @mentions, manual for new UI/API or follow-up launches, and workflow for nested calls. A disallowed selection is rejected without fallback; enable its permission in Recipes, change the selection/label, or choose an eligible default. Existing runs retain their accepted definitions; replies and resume do not select a new workflow. Use these supported launch methods when starting work. When the task requests changes to this product, evaluate the proposed behavior against the task's requirements and accepted decisions, within your assigned role. Missing current capabilities are implementation work, not a conflict with these instructions; update the capability reference alongside an implemented behavior change. Explicit task restrictions such as planning-only or deferred implementation still apply.
</description>

<available_repositories>
  <repository name="Frontend App" (current)>
    <github_url>https://github.com/myorg/frontend-app</github_url>
    <gitlab_url>N/A</gitlab_url>
    <routing_methods>
    - Description tag: \`[repo=myorg/frontend-app]\` or \`[repo=myorg/frontend-app#branch]\` for base branch override
    - Routing labels: "frontend", "ui"
    - Team keys: "FE" (create issue in this team)
    </routing_methods>
  </repository>
  <repository name="Backend API">
    <github_url>https://github.com/myorg/backend-api</github_url>
    <gitlab_url>N/A</gitlab_url>
    <routing_methods>
    - Description tag: \`[repo=myorg/backend-api]\` or \`[repo=myorg/backend-api#branch]\` for base branch override
    - Routing labels: "backend", "api"
    - Team keys: "BE" (create issue in this team)
    - Project keys: "API Project" (add issue to this project)
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<user_comment>
Orchestrate this cross-repo feature
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should exclude inactive repositories from routing context", async () => {
		const activeRepo = {
			id: "repo-active-123",
			name: "Active Repo",
			repositoryPath: "/test/active",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",

			baseBranch: "main",
			githubUrl: "https://github.com/org/active-repo",
			isActive: true,
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const inactiveRepo = {
			id: "repo-inactive-456",
			name: "Inactive Repo",
			repositoryPath: "/test/inactive",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",

			baseBranch: "main",
			githubUrl: "https://github.com/org/inactive-repo",
			isActive: false,
		};

		const worker = createTestWorker([activeRepo, inactiveRepo]);

		const session = {
			issueId: "issue-789",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-789",
			identifier: "TEST-300",
			title: "Test inactive filtering",
			description: "Should not show inactive repo",
		};

		// Only one active repo means no routing context (same as single-repo case)
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(activeRepo)
			.withUserComment("Check routing context")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Active Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-789</id>
<identifier>TEST-300</identifier>
<title>Test inactive filtering</title>
<description>Should not show inactive repo</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check routing context
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should only include repositories from the same workspace", async () => {
		const workspace1Repo = {
			id: "repo-ws1-123",
			name: "Workspace 1 Repo",
			repositoryPath: "/test/ws1",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-repo",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2Repo = {
			id: "repo-ws2-456",
			name: "Workspace 2 Repo",
			repositoryPath: "/test/ws2",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-repo",
		};

		const worker = createTestWorker([workspace1Repo, workspace2Repo]);

		const session = {
			issueId: "issue-999",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-999",
			identifier: "WS1-100",
			title: "Workspace isolation test",
			description: "Should not show other workspace repos",
		};

		// Only one repo in this workspace means no routing context
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(workspace1Repo)
			.withUserComment("Check workspace isolation")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Workspace 1 Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-999</id>
<identifier>WS1-100</identifier>
<title>Workspace isolation test</title>
<description>Should not show other workspace repos</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check workspace isolation
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("generateRoutingContextForAllWorkspaces should include routing contexts for each multi-repo workspace", () => {
		const workspace1RepoA = {
			id: "repo-ws1-a",
			name: "Workspace One App",
			repositoryPath: "/test/ws1/app",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-app",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace1RepoB = {
			id: "repo-ws1-b",
			name: "Workspace One API",
			repositoryPath: "/test/ws1/api",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-api",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2RepoA = {
			id: "repo-ws2-a",
			name: "Workspace Two Service",
			repositoryPath: "/test/ws2/service",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-service",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2RepoB = {
			id: "repo-ws2-b",
			name: "Workspace Two Worker",
			repositoryPath: "/test/ws2/worker",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-worker",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([
			workspace1RepoA,
			workspace1RepoB,
			workspace2RepoA,
			workspace2RepoB,
		]);

		const promptBuilder = (worker as any).promptBuilder as {
			generateRoutingContextForAllWorkspaces: () => string;
		};
		const context = promptBuilder.generateRoutingContextForAllWorkspaces();

		expect(context.match(/<repository_routing_context>/g)?.length || 0).toBe(2);
		expect(context).toContain("Workspace One App");
		expect(context).toContain("Workspace Two Service");
		expect(context).toContain("`[repo=org/ws1-app]`");
		expect(context).toContain("`[repo=org/ws2-service]`");
	});
});
