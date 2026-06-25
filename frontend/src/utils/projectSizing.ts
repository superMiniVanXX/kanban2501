// Continuous card sizing for the project "wall".
// Width is max-normalized: the largest project gets CARD_MAX_PX, others scale linearly by task count.

export const CARD_MIN_PX = 180;
export const CARD_MAX_PX = 520;

export type Density = 'compact' | 'normal' | 'expanded';

/**
 * Compute card width in pixels, clamped to [CARD_MIN_PX, CARD_MAX_PX].
 * Linear scaling relative to the largest project's task count.
 */
export function computeCardWidth(tasks: number, maxTasks: number): number {
  if (maxTasks <= 0) return CARD_MIN_PX;
  const ratio = tasks / maxTasks;
  return Math.max(CARD_MIN_PX, Math.min(CARD_MAX_PX, ratio * CARD_MAX_PX));
}

/** Content density buckets derived from the actual rendered width. */
export function getDensity(widthPx: number): Density {
  if (widthPx < 260) return 'compact';
  if (widthPx < 400) return 'normal';
  return 'expanded';
}
