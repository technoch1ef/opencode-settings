/**
 * Backwards-compatible re-export.
 *
 * The canonical source is now src/lib/shared.ts.
 * This file remains so existing imports (tests, plugins) continue to resolve.
 */
export {
  compareBrIssuesDeterministic,
  fixShellSnippetNewlines,
  guardSingleInProgress,
  inferAssigneeFromText,
  OVERSEER_WORK_LOOP_PROMPT,
  selectDeterministicReady,
  WORKER_WORK_LOOP_PROMPT,
  type BrIssue,
  type SingleInProgressGuardResult,
} from "../src/lib/shared";
