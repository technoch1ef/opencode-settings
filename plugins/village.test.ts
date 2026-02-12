import { describe, expect, test } from "bun:test";

import { fixShellSnippetNewlines } from "./village";

describe("fixShellSnippetNewlines", () => {
  test("replaces literal \\n separator tokens in shell code fences", () => {
    const input = [
      "```bash",
      "bd create foo; \\nbd update bar --status in_progress",
      "```",
      "",
    ].join("\n");

    const out = fixShellSnippetNewlines(input);

    expect(out).not.toContain("\\n");
    expect(out).toContain("bd create foo;\n");
    expect(out).toContain("bd update bar --status in_progress");
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
