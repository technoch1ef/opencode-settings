/**
 * Tools barrel — re-exports all tool factories.
 */
export { createClaimTool } from "./claim";
export { createHandoffTool, isHandoffAllowed, formatHandoffComment, HANDOFF_MATRIX, VILLAGE_ROLES } from "./handoff";
export type { VillageRole } from "./handoff";
export { createScaffoldTool, isStructuredBody, renderScaffoldDescription } from "./scaffold";
export { createOrphansTool } from "./orphans";
export { createStatusTool } from "./status";
