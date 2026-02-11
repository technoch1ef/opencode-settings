import { tool } from "@opencode-ai/plugin";

export const listIssues = tool({
  description: "List GitHub issues in a repository",
  args: {
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
    state: tool.schema.enum(["open", "closed", "all"]).optional().describe("Filter by issue state (default: open)"),
    limit: tool.schema.number().optional().describe("Maximum number of issues to list (default: 10)"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    const state = args.state ? `--state ${args.state}` : "--state open";
    const limit = args.limit ? `--limit ${args.limit}` : "--limit 10";
    
    try {
      const result = await Bun.$`gh issue list ${repo} ${state} ${limit}`.text();
      return result;
    } catch (error: any) {
      return `Error listing issues: ${error.stderr || error.message}`;
    }
  },
});

export const createIssue = tool({
  description: "Create a new GitHub issue",
  args: {
    title: tool.schema.string().describe("Issue title"),
    body: tool.schema.string().optional().describe("Issue description/body"),
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
    labels: tool.schema.string().optional().describe("Comma-separated labels to add"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    const body = args.body ? `--body "${args.body}"` : "";
    const labels = args.labels ? `--label "${args.labels}"` : "";
    
    try {
      const result = await Bun.$`gh issue create ${repo} --title "${args.title}" ${body} ${labels}`.text();
      return result;
    } catch (error: any) {
      return `Error creating issue: ${error.stderr || error.message}`;
    }
  },
});

export const listPullRequests = tool({
  description: "List GitHub pull requests in a repository",
  args: {
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
    state: tool.schema.enum(["open", "closed", "merged", "all"]).optional().describe("Filter by PR state (default: open)"),
    limit: tool.schema.number().optional().describe("Maximum number of PRs to list (default: 10)"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    const state = args.state ? `--state ${args.state}` : "--state open";
    const limit = args.limit ? `--limit ${args.limit}` : "--limit 10";
    
    try {
      const result = await Bun.$`gh pr list ${repo} ${state} ${limit}`.text();
      return result;
    } catch (error: any) {
      return `Error listing pull requests: ${error.stderr || error.message}`;
    }
  },
});

export const createPullRequest = tool({
  description: "Create a new GitHub pull request",
  args: {
    title: tool.schema.string().describe("Pull request title"),
    body: tool.schema.string().optional().describe("Pull request description"),
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
    head: tool.schema.string().optional().describe("Head branch (feature branch)"),
    base: tool.schema.string().optional().describe("Base branch (default: main)"),
    draft: tool.schema.boolean().optional().describe("Create as draft PR"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    const body = args.body ? `--body "${args.body}"` : "";
    const head = args.head ? `--head ${args.head}` : "";
    const base = args.base ? `--base ${args.base}` : "";
    const draft = args.draft ? "--draft" : "";
    
    try {
      const result = await Bun.$`gh pr create ${repo} --title "${args.title}" ${body} ${head} ${base} ${draft}`.text();
      return result;
    } catch (error: any) {
      return `Error creating pull request: ${error.stderr || error.message}`;
    }
  },
});

export const checkoutBranch = tool({
  description: "Checkout or create a new Git branch",
  args: {
    branch: tool.schema.string().describe("Branch name"),
    create: tool.schema.boolean().optional().describe("Create branch if it doesn't exist"),
  },
  async execute(args) {
    const create = args.create ? "-b" : "";
    
    try {
      const result = await Bun.$`git checkout ${create} ${args.branch}`.text();
      return result || `Checked out branch: ${args.branch}`;
    } catch (error: any) {
      return `Error checking out branch: ${error.stderr || error.message}`;
    }
  },
});

export const getRepositoryInfo = tool({
  description: "Get information about a GitHub repository",
  args: {
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    
    try {
      const result = await Bun.$`gh repo view ${repo}`.text();
      return result;
    } catch (error: any) {
      return `Error getting repository info: ${error.stderr || error.message}`;
    }
  },
});

export const addLabel = tool({
  description: "Add labels to an issue or pull request",
  args: {
    number: tool.schema.number().describe("Issue or PR number"),
    labels: tool.schema.string().describe("Comma-separated labels to add"),
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    
    try {
      const result = await Bun.$`gh issue edit ${args.number} ${repo} --add-label "${args.labels}"`.text();
      return result || `Added labels to #${args.number}`;
    } catch (error: any) {
      return `Error adding labels: ${error.stderr || error.message}`;
    }
  },
});

export const closeIssue = tool({
  description: "Close a GitHub issue",
  args: {
    number: tool.schema.number().describe("Issue number"),
    reason: tool.schema.string().optional().describe("Closing reason/message"),
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    
    try {
      const result = await Bun.$`gh issue close ${args.number} ${repo}`.text();
      return result || `Closed issue #${args.number}`;
    } catch (error: any) {
      return `Error closing issue: ${error.stderr || error.message}`;
    }
  },
});

export const mergePullRequest = tool({
  description: "Merge a GitHub pull request",
  args: {
    number: tool.schema.number().describe("Pull request number"),
    method: tool.schema.enum(["squash", "rebase", "merge"]).optional().describe("Merge method (default: merge)"),
    repo: tool.schema.string().optional().describe("Repository in format 'owner/repo' (uses current repo if not specified)"),
  },
  async execute(args) {
    const repo = args.repo ? `--repo ${args.repo}` : "";
    const method = args.method ? `--${args.method}` : "";
    
    try {
      const result = await Bun.$`gh pr merge ${args.number} ${repo} ${method}`.text();
      return result || `Merged PR #${args.number}`;
    } catch (error: any) {
      return `Error merging pull request: ${error.stderr || error.message}`;
    }
  },
});
