# GitHub Integration Rules

## Overview
These rules guide OpenCode's automatic GitHub capabilities.

## GitHub Tool Usage
Use the following GitHub tools for repository operations:

- **github_listIssues** - List issues in a repository
- **github_createIssue** - Create a new GitHub issue
- **github_listPullRequests** - List pull requests
- **github_createPullRequest** - Create a new pull request
- **github_checkoutBranch** - Checkout or create a Git branch
- **github_getRepositoryInfo** - Get repository information
- **github_addLabel** - Add labels to issues/PRs
- **github_closeIssue** - Close an issue
- **github_mergePullRequest** - Merge a pull request

## Best Practices

### Issue Management
- Always provide descriptive issue titles and descriptions
- Add appropriate labels when creating issues
- Use the `state` parameter to filter issues effectively
- When closing issues, provide context about the solution

### Pull Request Workflow
1. Always use `--draft` flag when creating draft PRs
2. Provide clear PR descriptions explaining the changes
3. Reference related issues using GitHub's syntax (#issue_number)
4. Use appropriate merge methods (squash for small changes, merge for feature branches)

### Branch Management
- Use descriptive branch names (e.g., `feature/add-dark-mode`, `fix/auth-bug`)
- Always verify you're on the correct base branch before creating PRs
- Clean up merged branches

### Repository Operations
- Check repository info before making significant changes
- Always verify repository access and permissions
- Use `repo` parameter to explicitly target repositories when working across multiple repos

## Automatic Capabilities

When asked to:
- **"List GitHub issues"** → Use `listIssues` tool
- **"Create an issue"** → Use `createIssue` tool with title and description
- **"List pull requests"** → Use `listPullRequests` tool
- **"Create a PR"** → Use `createPullRequest` tool
- **"Create a branch"** → Use `checkoutBranch` tool with `create: true`
- **"Get repo info"** → Use `getRepositoryInfo` tool
- **"Add labels"** → Use `addLabel` tool
- **"Close an issue"** → Use `closeIssue` tool
- **"Merge a PR"** → Use `mergePullRequest` tool

## Error Handling
- Always handle GitHub CLI errors gracefully
- Check if you're authenticated with `gh auth status` if operations fail
- Provide helpful error messages to the user
- Suggest authentication if permission errors occur

## Integration with Git
- Use bash tool for git operations (commit, push, etc.)
- Combine GitHub tools with bash for complete workflows
- Always push branches before creating PRs
- Verify branch status before opening PRs
