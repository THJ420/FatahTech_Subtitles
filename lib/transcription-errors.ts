export interface TranscriptionErrorDetails {
  name: string;
  message: string;
  stack?: string;
  cause?: TranscriptionErrorDetails;
}

export function serializeTranscriptionError(
  error: unknown,
  depth = 0,
): TranscriptionErrorDetails {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error) };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined && depth < 4
      ? { cause: serializeTranscriptionError(error.cause, depth + 1) }
      : {}),
  };
}

function errorChain(error: unknown): string {
  let details: TranscriptionErrorDetails | undefined =
    serializeTranscriptionError(error);
  const messages: string[] = [];
  while (details) {
    messages.push(`${details.name}: ${details.message}`);
    details = details.cause;
  }
  return messages.join("\n");
}

export function isModelNetworkError(error: unknown): boolean {
  return /\bnetwork\s*error\b|\bnetwork request failed\b|\bfailed to fetch\b|\b(?:TypeError|Error):\s*Load failed\b|\bHTTP [45]\d\d\b|\btimeout\b|\btimed out\b|\bCORS\b|Could not locate file:|Forbidden access to file|Unauthorized access to file|Bad gateway|Service unavailable/i.test(
    errorChain(error),
  );
}

export function getModelLoadingErrorMessage(
  error: unknown,
  { online }: { online?: boolean } = {},
): string {
  const details = errorChain(error);
  const retry =
    "Select Generate subtitles to try again. Your video stays on your device.";

  if (/QuotaExceededError|CacheStorage|browser cache/i.test(details)) {
    return `Browser storage could not read or save the speech model. Allow site storage or free some disk space, then retry while online. ${retry}`;
  }
  if (isModelNetworkError(error)) {
    const offline =
      online === false
        ? "You appear to be offline. Reconnect to download missing files; offline use requires the complete model and runtime to have been cached."
        : "Check your internet connection and allow Hugging Face downloads through your proxy or firewall. A browser extension or CORS policy may also block the request.";
    const runtime = /ort-wasm|\.wasm\b|dynamically imported module/i.test(
      details,
    )
      ? " The speech runtime could not load. Reload the page; if it persists, verify that the deployed runtime assets return JavaScript/WASM, not a 404 page."
      : "";
    return `The speech model files could not be loaded. ${offline}${runtime} ${retry}`;
  }
  if (
    /SyntaxError|Unexpected token|invalid (?:JSON|protobuf)|HTML instead|WebAssembly.*(?:compile|magic)/i.test(
      details,
    )
  ) {
    return `A speech model or runtime file could not be parsed. A proxy may have returned an HTML page, or a cached file may be damaged. Check the browser console for the original error before clearing the affected model cache. ${retry}`;
  }
  return error instanceof Error ? error.message : String(error);
}
