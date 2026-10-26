/** Use the same source duration as background processing, without rounding minutes. */
export function getBackgroundRemovalWarningDuration(
  nativeDuration: number,
  fallbackDuration: number,
): number | null {
  const duration =
    Number.isFinite(nativeDuration) && nativeDuration > 0
      ? nativeDuration
      : fallbackDuration;
  return Number.isFinite(duration) && duration > 2 * 60 ? duration : null;
}
