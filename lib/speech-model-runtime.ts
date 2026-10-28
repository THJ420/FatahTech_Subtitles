import { serializeTranscriptionError } from "./transcription-errors";

export type SpeechAssetDiagnostic = {
  operation: "fetch" | "cache-open" | "cache-read" | "cache-write";
  url?: string;
  httpStatus?: number;
  contentType?: string | null;
  error?: ReturnType<typeof serializeTranscriptionError>;
};

type ReportDiagnostic = (diagnostic: SpeechAssetDiagnostic) => void;

export function createSpeechModelFetch(
  fetchResource: typeof fetch,
  report: ReportDiagnostic,
): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    try {
      const response = await fetchResource(input, init);
      if (!response.ok) {
        report({ operation: "fetch", url, httpStatus: response.status });
      }
      if (
        response.ok &&
        response.headers.get("content-type")?.includes("text/html")
      ) {
        throw new Error(
          `Received HTML instead of a speech model/runtime asset at ${url}`,
        );
      }
      return response;
    } catch (error) {
      report({
        operation: "fetch",
        url,
        error: serializeTranscriptionError(error),
      });
      throw new Error(`Speech asset request failed at ${url}`, {
        cause: error,
      });
    }
  };
}

export function createSpeechModelCache(
  storage: { open(name: string): Promise<Pick<Cache, "match" | "put">> },
  report: ReportDiagnostic,
) {
  let cachePromise:
    | Promise<Pick<Cache, "match" | "put"> | undefined>
    | undefined;
  const open = () =>
    (cachePromise ??= storage.open("transformers-cache").catch((error) => {
      report({
        operation: "cache-open",
        error: serializeTranscriptionError(error),
      });
      return undefined;
    }));

  return {
    async match(request: string): Promise<Response | undefined> {
      try {
        return await (await open())?.match(request);
      } catch (error) {
        report({
          operation: "cache-read",
          url: request,
          error: serializeTranscriptionError(error),
        });
        return undefined;
      }
    },
    async put(request: string, response: Response): Promise<void> {
      try {
        await (await open())?.put(request, response);
      } catch (error) {
        report({
          operation: "cache-write",
          url: request,
          error: serializeTranscriptionError(error),
        });
      }
    },
  };
}
