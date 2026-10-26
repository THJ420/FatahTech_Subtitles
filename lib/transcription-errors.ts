const MODEL_NETWORK_MESSAGE =
  "The speech model files could not be loaded. Check your internet connection, then select Generate subtitles to try again. Your video stays on your device.";

export function isModelNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && error.name === "NetworkError") ||
    /\bnetwork\s*error\b|\bnetwork request failed\b|\bfailed to fetch\b|\bTypeError:\s*Load failed\b/i.test(
      message,
    ) ||
    message.trim().toLowerCase() === "load failed"
  );
}

/** Keep non-network diagnostics intact; only add recovery guidance for fetch failures. */
export function getModelLoadingErrorMessage(error: unknown): string {
  return isModelNetworkError(error)
    ? MODEL_NETWORK_MESSAGE
    : error instanceof Error
      ? error.message
      : String(error);
}
