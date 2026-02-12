import { describe, expect, test } from "bun:test";

import { fixShellSnippetNewlines } from "../plugins/village";

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
