# OpenCode Atlassian MCP Quickstart

This guide configures OpenCode to use Atlassian's remote MCP server for Jira and Confluence.

## 1) Add MCP server config

Update `~/.config/opencode/opencode.json` with this block:

```json
{
  "mcp": {
    "atlassian": {
      "type": "remote",
      "url": "https://mcp.atlassian.com/v1/mcp",
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

Notes:

- Use OAuth auto-detection/dynamic registration.
- Do not add tokens, client secrets, or API keys to git-tracked files.

## 2) Restart OpenCode

After saving config, restart OpenCode so it reloads MCP settings:

```bash
opencode
```

## 3) Authenticate with Atlassian OAuth

Start auth flow:

```bash
opencode mcp auth atlassian
```

Then verify connection:

```bash
opencode mcp list
```

Expected status: `atlassian connected`.

## 4) Smoke test Jira/Confluence reads

Jira example:

```bash
opencode run "Use Atlassian MCP to list up to 3 Jira projects and return only project keys and names."
```

Confluence example:

```bash
opencode run "Use Atlassian MCP to search Confluence spaces and return up to 3 space keys with names."
```

If MCP calls are visible in output and data is returned, the integration is working.

## Troubleshooting checklist

- [ ] Atlassian org admin has approved the OAuth app/integration.
- [ ] Network allows outbound access to `mcp.atlassian.com` and Atlassian Cloud APIs.
- [ ] Site IP allowlist includes your current egress IP (if enforced).
- [ ] Re-auth completed (`opencode mcp logout atlassian` then `opencode mcp auth atlassian`).
- [ ] `opencode mcp list` shows `atlassian connected`.
- [ ] `opencode mcp debug atlassian` shows authenticated state without terminal errors.

For a recorded run, see `ATLASSIAN_MCP_SMOKE_TEST.md`.
