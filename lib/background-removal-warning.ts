/**
 * Long clips are worth flagging earlier than the old two-minute threshold: the
 * salient-object model is roughly four times MODNet's compute, so a clip that
 * used to process in a minute can now take several.
 */
export const BACKGROUND_REMOVAL_WARNING_SECONDS = 90;

/** Use the same source duration as background processing, without rounding minutes. */
export function getBackgroundRemovalWarningDuration(
  nativeDuration: number,
  fallbackDuration: number,
): number | null {
  const duration =
    Number.isFinite(nativeDuration) && nativeDuration > 0
      ? nativeDuration
      : fallbackDuration;
  return Number.isFinite(duration) &&
    duration > BACKGROUND_REMOVAL_WARNING_SECONDS
    ? duration
    : null;
}
