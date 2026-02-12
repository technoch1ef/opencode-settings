# Atlassian MCP OAuth and Smoke Test

Date: 2026-02-12
Branch: `epic/mcp-atlassian-opencode`

## OAuth verification

- Ran `opencode mcp auth atlassian`
- Result: Authentication successful
- Ran `opencode mcp list`
- Result: `atlassian` status is `connected`

## Jira read smoke test

- Command:

```bash
opencode run "Use Atlassian MCP to list up to 3 Jira projects and return only project keys and names. If unavailable, explain why."
```

- Result: Successful read via `atlassian_getVisibleJiraProjects`
- Sample returned projects: `AACF`, `ADE`, `ADES`

## Confluence read smoke test

- Command:

```bash
opencode run "Use Atlassian MCP to search Confluence spaces and return up to 3 space keys with names."
```

- Result: Successful read via `atlassian_getConfluenceSpaces`
- Sample returned spaces: `PROD`, `AN`, `EN`

## Troubleshooting notes

- Admin approval: if OAuth fails with app approval errors, ask Atlassian org admin to approve the app/integration.
- Domain allowlist: ensure outbound access to `mcp.atlassian.com` and Atlassian Cloud API domains is allowed by proxy/firewall.
- IP allowlist: if Atlassian site enforces IP allowlisting, add the current network egress IP.
- Stale auth state: run `opencode mcp logout atlassian` then `opencode mcp auth atlassian` to re-auth.
- Status checks: use `opencode mcp list` and `opencode mcp debug atlassian` for diagnostics.
