# OpenCode GitHub Integration - Quick Reference

## 🚀 Getting Started

Your OpenCode now has automatic GitHub capabilities! Your settings are backed up in git.

### First Time Setup

```bash
# Verify GitHub CLI is working
gh auth status

# Navigate to any git repository
cd /path/to/your/repo

# Start OpenCode with GitHub agent
opencode
```

## 📋 Common Tasks

### List Issues
```
Show me all open issues in this repository
```
Uses: `github_listIssues` with state="open"

### Create an Issue
```
Create an issue titled "Fix login page bug" with description "Users report errors on login"
```
Uses: `github_createIssue` with automatic tool selection

### Manage Pull Requests
```
List all pull requests and show me which ones are ready to merge
```
Uses: `github_listPullRequests`

### Create a Feature Branch
```
Create a new branch called feature/dark-mode
```
Uses: `github_checkoutBranch` with create=true

### Create a Pull Request
```
Create a PR from feature/dark-mode to main with title "Add dark mode support"
```
Uses: `github_createPullRequest`

### Add Labels
```
Add "bug" and "high-priority" labels to issue #42
```
Uses: `github_addLabel`

### Close Issues
```
Close issue #15 - the bug has been fixed
```
Uses: `github_closeIssue`

### Merge Pull Requests
```
Merge pull request #10 using squash merge
```
Uses: `github_mergePullRequest` with method="squash"

## 🛠️ Tools Overview

| Tool | Purpose | Parameters |
|------|---------|-----------|
| `listIssues` | List repository issues | repo, state, limit |
| `createIssue` | Create new issue | title, body, repo, labels |
| `listPullRequests` | List PRs | repo, state, limit |
| `createPullRequest` | Create PR | title, body, repo, head, base, draft |
| `checkoutBranch` | Create/checkout branch | branch, create |
| `getRepositoryInfo` | Get repo metadata | repo |
| `addLabel` | Add labels | number, labels, repo |
| `closeIssue` | Close an issue | number, reason, repo |
| `mergePullRequest` | Merge PR | number, method, repo |

## 🎯 Advanced Usage

### Using the GitHub Agent Explicitly
```
@github List all issues tagged as "help-wanted"
```

### With /github Command
```
/github Create a branch called bugfix/navbar-alignment
```

### Combining Tools
```
Create a new branch called feature/auth-v2, then create a pull request 
from that branch to main with the title "Implement new authentication flow"
```

## 📁 Configuration Files

- **Main Config**: `~/.config/opencode/opencode.json`
  - Defines github agent
  - Loads github tools and rules
  
- **Tools**: `~/.config/opencode/tools/github.ts`
  - 9 GitHub automation tools
  - TypeScript with full type safety
  
- **Rules**: `~/.config/opencode/.opencode/github-rules.md`
  - Best practices
  - Automatic capability mappings
  
- **Agent**: `~/.config/opencode/.opencode/agents/github.md`
  - GitHub-focused agent definition
  
- **Documentation**: `~/.config/opencode/GITHUB_SETUP.md`
  - Complete setup and troubleshooting guide

## 🔑 Authentication

Your GitHub authentication is handled automatically via GitHub CLI.

### Check Status
```bash
gh auth status
```

### Refresh Token Scopes
```bash
gh auth refresh --scopes repo,admin:repo_hook,gist
```

### Using Specific Token
```bash
export GH_TOKEN=your_personal_access_token
```

## ⚙️ Configuration Options

### Per-Project Settings
Create `.opencode.json` in your project root:
```json
{
  "agent": {
    "github": {
      "prompt": "Custom instructions for this project"
    }
  }
}
```

### Tool Permissions
Already configured in `opencode.json`:
- All GitHub tools enabled
- Bash tools enabled (for git operations)
- File manipulation tools enabled

## 🐛 Troubleshooting

### GitHub CLI Not Found
```bash
brew install gh  # macOS
sudo apt install gh  # Linux
```

### Authentication Failed
```bash
gh auth logout
gh auth login
```

### Tool Not Running
Check Bun/TypeScript compilation:
```bash
bun --version
```

### Permission Denied
Ensure your token has correct scopes:
```bash
gh auth refresh --scopes repo
```

## 📚 File Locations

```
~/.config/opencode/
├── opencode.json                    # Main config (UPDATED)
├── tools/
│   └── github.ts                   # GitHub tools
├── .opencode/
│   ├── agents/
│   │   └── github.md               # GitHub agent
│   └── github-rules.md             # GitHub rules
├── GITHUB_SETUP.md                 # Full setup guide
└── .git/                           # Git repository (NEW)
```

## 🔄 Sync Your Settings

Your settings are already backed up in git!

### Push to Remote
```bash
cd ~/.config/opencode
git remote add origin https://github.com/YOUR-USERNAME/opencode-settings.git
git branch -M main
git push -u origin main
```

### Pull on Another Machine
```bash
git clone https://github.com/YOUR-USERNAME/opencode-settings.git ~/.config/opencode
cd ~/.config/opencode
bun install
```

## 💡 Pro Tips

1. **Always verify repository context** before making changes
2. **Use draft PRs** when features are work-in-progress
3. **Reference issues in PRs** using #issue_number syntax
4. **Combine with bash tools** for powerful automation
5. **Label issues effectively** for organization
6. **Use descriptive branch names** following conventions

## 🚀 Example Workflows

### Complete Feature Implementation
```
1. Create branch: "Create branch feature/user-profiles"
2. Make changes with: "Edit src/components/Profile.tsx to..."
3. Create PR: "Create a pull request titled 'Add user profile pages'"
4. Add labels: "Add 'feature' and 'frontend' labels to #42"
```

### Bug Fix Workflow
```
1. Create branch: "Create branch bugfix/auth-logout"
2. Fix code: "Fix the logout endpoint in src/api/auth.ts"
3. Test: "Run the test suite"
4. Create PR: "Create PR to fix authentication bug"
5. Add label: "Add 'bug' label to this PR"
```

### Issue Triage
```
"List all open issues, categorize them into bugs and features,
and add appropriate labels to each"
```

## 📖 More Information

- OpenCode Docs: https://opencode.ai/docs
- GitHub CLI Docs: https://cli.github.com
- Set up guide: `~/.config/opencode/GITHUB_SETUP.md`

---

**Ready to automate GitHub!** Start with: `opencode` then ask about your repository 🎉
