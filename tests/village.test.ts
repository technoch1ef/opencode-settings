import { describe, expect, test } from "bun:test";

import {
  fixShellSnippetNewlines,
  guardSingleInProgress,
  inferAssigneeFromText,
  OVERSEER_WORK_LOOP_PROMPT,
  selectDeterministicReady,
  WORKER_WORK_LOOP_PROMPT,
} from "../lib/village-shared";

describe("fixShellSnippetNewlines", () => {
  test("replaces literal \\n separator tokens in shell code fences", () => {
    const input = [
      "```bash",
      "bd create foo; \\nbd update bar --status in_progress",
      "```",
      "",
    ].join("\n");

    const out = fixShellSnippetNewlines(input);
    expect(typeof out).toBe("string");
    if (typeof out !== "string") throw new Error("Expected string output");

    expect(out).not.toContain("\\n");
    expect(out).toContain("bd create foo;\n");
    expect(out).toContain("bd update bar --status in_progress");
  });

  test("is a no-op for non-string inputs", () => {
    expect(fixShellSnippetNewlines(123 as any)).toBe(123);
  });

  test("does not touch non-shell code fences", () => {
    const input = [
      "```json",
      '{"newline": "\\\\n"}',
      "```",
      "",
    ].join("\n");

    const out = fixShellSnippetNewlines(input);
    expect(out).toBe(input);
  });
});

describe("selectDeterministicReady", () => {
  test("selects lowest priority", () => {
    const ready = [
      { id: "a", priority: 2, created_at: "2026-01-01T00:00:00Z" },
      { id: "b", priority: 0, created_at: "2026-12-31T00:00:00Z" },
      { id: "c", priority: 1, created_at: "2026-01-01T00:00:00Z" },
    ];

    const selected = selectDeterministicReady(ready as any);
    expect(selected?.id).toBe("b");
  });

  test("breaks ties by created_at then id", () => {
    const ready = [
      { id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: "a", priority: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: "c", priority: 1, created_at: "2026-01-02T00:00:00Z" },
    ];

    const selected = selectDeterministicReady(ready as any);
    expect(selected?.id).toBe("a");
  });

  test("treats invalid created_at as last", () => {
    const ready = [
      { id: "a", priority: 1, created_at: "not-a-date" },
      { id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" },
    ];

    const selected = selectDeterministicReady(ready as any);
    expect(selected?.id).toBe("b");
  });
});

describe("guardSingleInProgress", () => {
  test("returns none for empty", () => {
    expect(guardSingleInProgress([])).toEqual({ kind: "none" });
  });

  test("returns existing for single", () => {
    const issue = { id: "opencode-1", title: "one" };
    const out = guardSingleInProgress([issue as any]);
    expect(out.kind).toBe("existing");
    if (out.kind !== "existing") throw new Error("Expected existing");
    expect(out.issue.id).toBe("opencode-1");
  });

  test("returns multiple with deterministic ordering", () => {
    const out = guardSingleInProgress([
      { id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" } as any,
      { id: "a", priority: 1, created_at: "2026-01-01T00:00:00Z" } as any,
    ]);

    expect(out.kind).toBe("multiple");
    if (out.kind !== "multiple") throw new Error("Expected multiple");
    expect(out.issues.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("inferAssigneeFromText", () => {
  test("routes review/check-like text to overseer", () => {
    expect(inferAssigneeFromText("Please review this")).toBe("overseer");
    expect(inferAssigneeFromText("Run checks and approve")).toBe("overseer");
    expect(inferAssigneeFromText("Verification needed")).toBe("overseer");
  });

  test("defaults to worker", () => {
    expect(inferAssigneeFromText("Implement the feature")).toBe("worker");
  });
});

describe("work loop prompt invariants", () => {
  test("prompts reference village_claim and do not use bd ready as claim path", () => {
    expect(WORKER_WORK_LOOP_PROMPT).toContain("village_claim");
    expect(WORKER_WORK_LOOP_PROMPT).not.toContain("bd ready --assignee worker");
    expect(WORKER_WORK_LOOP_PROMPT).not.toContain("--status in_progress");

    expect(OVERSEER_WORK_LOOP_PROMPT).toContain("village_claim");
    expect(OVERSEER_WORK_LOOP_PROMPT).not.toContain("bd ready --assignee overseer");
    expect(OVERSEER_WORK_LOOP_PROMPT).not.toContain("--status in_progress");
  });
});
