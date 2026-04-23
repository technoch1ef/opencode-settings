/**
 * Backwards-compatible re-export.
 *
 * The canonical source is now src/lib/shared.ts.
 * This file remains so existing imports (tests, plugins) continue to resolve.
 */
export {
  compareBrIssuesDeterministic,
  fixShellSnippetNewlines,
  GUARD_WORK_LOOP_PROMPT,
  guardSingleInProgress,
  inferAssigneeFromText,
  INSPECTOR_WORK_LOOP_PROMPT,
  selectDeterministicReady,
  VALID_ASSIGNEES,
  WORKER_WORK_LOOP_PROMPT,
  type BrIssue,
  type SingleInProgressGuardResult,
  type VillageAssignee,
} from "../src/lib/shared";
