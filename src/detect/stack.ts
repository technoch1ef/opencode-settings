/**
 * Stack detection utilities.
 *
 * Placeholder — actual detection logic will be implemented in a subsequent bead.
 */

export type StackInfo = {
  language: string;
  framework?: string;
  packageManager?: string;
};

/**
 * Detect the project's technology stack from the given directory.
 */
export async function detectStack(_directory: string): Promise<StackInfo | null> {
  // TODO: Implement stack detection (opencode-2c6.2+)
  return null;
}
