/**
 * Drops async results that finished after a newer local write invalidated them.
 * Used so a slow poll cannot overwrite a fresher leave/settle response.
 */
export type GenerationGate = {
  /** Invalidate in-flight loads; call when starting a mutation that writes view state. */
  bump: () => number;
  /** Capture at the start of a load; pass to `isCurrent` before applying. */
  snapshot: () => number;
  isCurrent: (token: number) => boolean;
};

export function createGenerationGate(): GenerationGate {
  let generation = 0;
  return {
    bump() {
      generation += 1;
      return generation;
    },
    snapshot() {
      return generation;
    },
    isCurrent(token: number) {
      return token === generation;
    },
  };
}
