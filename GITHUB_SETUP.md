# OpenCode GitHub Integration Setup Guide

## What's Been Set Up

Your OpenCode installation now has automatic GitHub capabilities! Here's what was configured:

### 1. **GitHub Tools** (`~/.config/opencode/tools/github.ts`)
Nine powerful tools for GitHub automation:

- **listIssues** - List repository issues with filtering
- **createIssue** - Create new issues with labels
- **listPullRequests** - List pull requests with state filtering
- **createPullRequest** - Create PRs with various options
- **checkoutBranch** - Create and checkout Git branches
- **getRepositoryInfo** - Get repository metadata
- **addLabel** - Add labels to issues/PRs
- **closeIssue** - Close issues
- **mergePullRequest** - Merge pull requests with different methods

### 2. **GitHub Agent** (`.opencode/agents/github.md`)
A specialized agent focused on GitHub operations with:
- Access to all GitHub tools
- Best practices and workflows
- Clear documentation

### 3. **GitHub Rules** (`.opencode/github-rules.md`)
Instructions that guide OpenCode's automatic GitHub capabilities with:
- Tool usage patterns
- Best practices
- Automatic capability mappings
- Error handling strategies

### 4. **Updated Config** (`~/.config/opencode/opencode.json`)
Enhanced configuration with:
- GitHub agent definition
- GitHub tool permissions
- Instructions loading

## Prerequisites

Make sure you have:

1. **GitHub CLI installed**: `brew install gh` (on macOS)
2. **GitHub authentication**: Run `gh auth login` if not already authenticated
3. **Git configured**: `git config --global user.name` and `git config --global user.email`

Verify your setup:
```bash
gh auth status
git config --global user.name
```

## Usage Examples

### Using the GitHub Agent

To use the GitHub agent explicitly, run:
```bash
opencode /github
```

Or in the TUI, use: `@github` when referencing the agent.

### Example Tasks

**List all open issues:**
```
List open issues in this repository
```

**Create a new issue:**
```
Create an issue titled "Add dark mode support" with description "Users want a dark theme option"
```

**Create a feature branch and PR:**
```
Create a new branch called feature/auth-improvements, make the changes, and open a PR to main
```

**Manage pull requests:**
```
List all open pull requests and merge any that have passed CI
```

**Add labels to issues:**
```
Add the "bug" and "high-priority" labels to issue #42
```

**Close an issue:**
```
Close issue #15 since the bug has been fixed
```

## Advanced Configuration

### Per-Project GitHub Config

To use different settings for specific projects, create `.opencode.json` in your project root:

```json
{
  "agent": {
    "github": {
      "prompt": "Custom instructions for this project's GitHub workflows"
    }
  }
}
```

### Environment Variables

GitHub CLI can be configured with environment variables:

```bash
export GH_TOKEN=your_token     # Use specific token
export GH_HOST=github.example.com  # Use GitHub Enterprise
```

### Custom Workflows

Extend GitHub capabilities by adding more custom tools in `~/.config/opencode/tools/`.

## Tool Reference

### Available GitHub Tools

All tools are accessible with the `github_` prefix. When using them:

```
List issues with: github_listIssues
Create issue with: github_createIssue
List PRs with: github_listPullRequests
Create PR with: github_createPullRequest
Checkout branch: github_checkoutBranch
Get repo info: github_getRepositoryInfo
Add labels: github_addLabel
Close issue: github_closeIssue
Merge PR: github_mergePullRequest
```

### Parameters

Most tools support:
- `repo` - Optional, format: `owner/repo` (uses current repo if not specified)
- `limit` - For list operations (default: 10)
- Additional tool-specific parameters (see tool descriptions)

## Troubleshooting

### Authentication Errors
```bash
gh auth status
gh auth login
```

### Permission Errors
Ensure your GitHub token has appropriate scopes:
```bash
gh auth refresh --scopes repo,admin:repo_hook,gist
```

### Tool Not Found
Make sure TypeScript/Bun can compile the tools:
```bash
bun --version
```

### GitHub CLI Not Found
Install GitHub CLI:
- macOS: `brew install gh`
- Linux: `sudo apt install gh` or see https://github.com/cli/cli
- Windows: `scoop install gh` or `choco install gh`

## Next Steps

1. **Verify authentication**: `gh auth status`
2. **Test a tool**: Ask OpenCode to "List issues in this repository"
3. **Create custom workflows**: Add more tools as needed
4. **Share your setup**: Push your `.opencode/` directory to version control

## Tips & Tricks

- Use the `@github` reference in prompts to explicitly use the GitHub agent
- Combine GitHub tools with bash tools for powerful automation
- Reference issues/PRs by number (#42) in your requests
- Use labels effectively to organize and filter work
- Create draft PRs before finalizing with `--draft` flag

## Support

For issues with:
- **OpenCode**: https://github.com/anomalyco/opencode/issues
- **GitHub CLI**: https://github.com/cli/cli/issues
- **This setup**: Check your GitHub CLI installation and authentication

Happy automating!
