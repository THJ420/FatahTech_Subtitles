import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSpeechModelCache,
  createSpeechModelFetch,
  type SpeechAssetDiagnostic,
} from "../lib/speech-model-runtime";

const assetUrl = "https://speech.test/models/encoder.onnx?revision=main";

test("fetch preserves inputs, options, and the unconsumed successful response", async (t) => {
  for (const input of [assetUrl, new URL(assetUrl), new Request(assetUrl)]) {
    const bytes = new Uint8Array([0, 97, 115, 109]);
    const response = new Response(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "x-model": "encoder",
      },
    });
    const fetchImpl = t.mock.fn<typeof fetch>(async () => response);
    const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
    const fetchModel = createSpeechModelFetch(fetchImpl, report);
    const init: RequestInit = {
      cache: "no-store",
      headers: { "x-request": "speech" },
      signal: new AbortController().signal,
    };

    const result = await fetchModel(input, init);

    assert.equal(fetchImpl.mock.callCount(), 1);
    assert.strictEqual(fetchImpl.mock.calls[0].arguments[0], input);
    assert.strictEqual(fetchImpl.mock.calls[0].arguments[1], init);
    assert.strictEqual(result, response);
    assert.equal(result.headers.get("x-model"), "encoder");
    assert.equal(result.bodyUsed, false);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
    assert.equal(report.mock.callCount(), 0);
  }
});

test("fetch rejection reports the original URL and error and preserves the cause", async (t) => {
  for (const input of [assetUrl, new URL(assetUrl), new Request(assetUrl)]) {
    const cause = new Error("Connection closed by proxy");
    const original = new TypeError("Failed to fetch", { cause });
    const fetchImpl = t.mock.fn<typeof fetch>(async () => {
      throw original;
    });
    const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
    const fetchModel = createSpeechModelFetch(fetchImpl, report);

    await assert.rejects(fetchModel(input), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `Speech asset request failed at ${assetUrl}`);
      assert.strictEqual(error.cause, original);
      return true;
    });

    assert.equal(fetchImpl.mock.callCount(), 1);
    assert.strictEqual(fetchImpl.mock.calls[0].arguments[0], input);
    assert.equal(report.mock.callCount(), 1);
    assert.deepEqual(report.mock.calls[0].arguments, [
      {
        operation: "fetch",
        url: assetUrl,
        error: {
          name: "TypeError",
          message: original.message,
          stack: original.stack,
          cause: { name: "Error", message: cause.message, stack: cause.stack },
        },
      },
    ]);
  }
});

test("non-OK responses are reported but returned, including optional-file HTML 404s", async (t) => {
  for (const status of [404, 403, 503]) {
    const body = "<html>Asset unavailable</html>";
    const response = new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const fetchImpl = t.mock.fn<typeof fetch>(async () => response);
    const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();

    const result = await createSpeechModelFetch(fetchImpl, report)(assetUrl);

    assert.strictEqual(result, response);
    assert.equal(result.status, status);
    assert.equal(result.bodyUsed, false);
    assert.equal(await result.text(), body);
    assert.equal(fetchImpl.mock.callCount(), 1);
    assert.equal(report.mock.callCount(), 1);
    assert.deepEqual(report.mock.calls[0].arguments, [
      {
        operation: "fetch",
        url: assetUrl,
        httpStatus: status,
      },
    ]);
  }
});

test("successful HTML responses reject with the asset URL and a reported parser cause", async (t) => {
  const response = new Response("<html>Proxy sign-in</html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const fetchImpl = t.mock.fn<typeof fetch>(async () => response);
  const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
  const fetchModel = createSpeechModelFetch(fetchImpl, report);

  await assert.rejects(fetchModel(assetUrl), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, `Speech asset request failed at ${assetUrl}`);
    assert.ok(error.cause instanceof Error);
    assert.equal(
      error.cause.message,
      `Received HTML instead of a speech model/runtime asset at ${assetUrl}`,
    );
    assert.equal(report.mock.callCount(), 1);
    assert.deepEqual(report.mock.calls[0].arguments, [
      {
        operation: "fetch",
        url: assetUrl,
        error: {
          name: "Error",
          message: error.cause.message,
          stack: error.cause.stack,
        },
      },
    ]);
    return true;
  });
  assert.equal(fetchImpl.mock.callCount(), 1);
  assert.equal(response.bodyUsed, false);
});

test("cache opens lazily once in transformers-cache and reuses existing and written data", async (t) => {
  const cachedUrl = "https://speech.test/models/config.json";
  const entries = new Map([
    [cachedUrl, new Response('{"model_type":"whisper"}')],
  ]);
  const cache = {
    match: t.mock.fn<Cache["match"]>(async (request) => {
      return entries.get(String(request))?.clone();
    }),
    put: t.mock.fn<Cache["put"]>(async (request, response) => {
      entries.set(String(request), response.clone());
    }),
  };
  const open = t.mock.fn(async () => cache);
  const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
  const modelCache = createSpeechModelCache({ open }, report);

  assert.equal(open.mock.callCount(), 0);
  const hits = await Promise.all([
    modelCache.match(cachedUrl),
    modelCache.match(cachedUrl),
  ]);
  for (const hit of hits) {
    assert.ok(hit);
    assert.deepEqual(await hit.json(), { model_type: "whisper" });
  }
  assert.deepEqual(cache.match.mock.calls[0].arguments, [cachedUrl]);

  const response = new Response("downloaded model");
  assert.equal(await modelCache.put(assetUrl, response), undefined);
  assert.equal(cache.put.mock.callCount(), 1);
  assert.strictEqual(cache.put.mock.calls[0].arguments[0], assetUrl);
  assert.strictEqual(cache.put.mock.calls[0].arguments[1], response);
  assert.equal(response.bodyUsed, false);
  const saved = await modelCache.match(assetUrl);
  assert.ok(saved);
  assert.equal(await saved.text(), "downloaded model");
  assert.equal(
    await modelCache.match("https://speech.test/missing.json"),
    undefined,
  );
  assert.equal(cache.match.mock.callCount(), 4);
  assert.equal(open.mock.callCount(), 1);
  assert.deepEqual(open.mock.calls[0].arguments, ["transformers-cache"]);
  assert.equal(report.mock.callCount(), 0);
});

test("cache read failures report a miss and allow an online fetch and cache write", async (t) => {
  const original = new Error("CacheStorage read failed");
  const cache = {
    match: t.mock.fn<Cache["match"]>(async () => {
      throw original;
    }),
    put: t.mock.fn<Cache["put"]>(async () => {}),
  };
  const open = t.mock.fn(async () => cache);
  const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
  const modelCache = createSpeechModelCache({ open }, report);
  const response = new Response("online model");
  const fetchImpl = t.mock.fn<typeof fetch>(async () => response);
  const fetchModel = createSpeechModelFetch(fetchImpl, report);

  const cached = await modelCache.match(assetUrl);
  assert.equal(cached, undefined);
  const result = cached ?? (await fetchModel(assetUrl));
  assert.equal(await modelCache.put(assetUrl, result), undefined);

  assert.strictEqual(result, response);
  assert.equal(await result.text(), "online model");
  assert.equal(fetchImpl.mock.callCount(), 1);
  assert.equal(cache.match.mock.callCount(), 1);
  assert.deepEqual(cache.match.mock.calls[0].arguments, [assetUrl]);
  assert.equal(cache.put.mock.callCount(), 1);
  assert.strictEqual(cache.put.mock.calls[0].arguments[1], response);
  assert.equal(open.mock.callCount(), 1);
  assert.equal(report.mock.callCount(), 1);
  assert.deepEqual(report.mock.calls[0].arguments, [
    {
      operation: "cache-read",
      url: assetUrl,
      error: {
        name: "Error",
        message: original.message,
        stack: original.stack,
      },
    },
  ]);
});

test("cache write failures are reported without consuming online data or disabling reads", async (t) => {
  const original = new DOMException(
    "Storage quota exhausted",
    "QuotaExceededError",
  );
  const cachedResponse = new Response("previously cached model");
  const cache = {
    match: t.mock.fn<Cache["match"]>(async () => cachedResponse),
    put: t.mock.fn<Cache["put"]>(async () => {
      throw original;
    }),
  };
  const open = t.mock.fn(async () => cache);
  const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
  const modelCache = createSpeechModelCache({ open }, report);
  const response = new Response("online model");

  assert.equal(await modelCache.put(assetUrl, response), undefined);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "online model");
  assert.strictEqual(await modelCache.match(assetUrl), cachedResponse);
  assert.equal(cache.match.mock.callCount(), 1);
  assert.equal(cache.put.mock.callCount(), 1);
  assert.strictEqual(cache.put.mock.calls[0].arguments[0], assetUrl);
  assert.strictEqual(cache.put.mock.calls[0].arguments[1], response);
  assert.equal(open.mock.callCount(), 1);
  assert.equal(report.mock.callCount(), 1);
  assert.deepEqual(report.mock.calls[0].arguments, [
    {
      operation: "cache-write",
      url: assetUrl,
      error: {
        name: "QuotaExceededError",
        message: original.message,
        stack: original.stack,
      },
    },
  ]);
});

test("failed cache open is attempted and reported only once across concurrent and later operations", async (t) => {
  const original = new DOMException("Site storage blocked", "SecurityError");
  const open = t.mock.fn<CacheStorage["open"]>(async () => {
    throw original;
  });
  const report = t.mock.fn<(diagnostic: SpeechAssetDiagnostic) => void>();
  const modelCache = createSpeechModelCache({ open }, report);
  const response = new Response("online model");

  assert.equal(open.mock.callCount(), 0);
  assert.deepEqual(
    await Promise.all([
      modelCache.match(assetUrl),
      modelCache.put(assetUrl, response),
      modelCache.match("https://speech.test/models/config.json"),
    ]),
    [undefined, undefined, undefined],
  );
  assert.equal(await modelCache.match(assetUrl), undefined);
  assert.equal(await modelCache.put(assetUrl, response), undefined);
  assert.equal(open.mock.callCount(), 1);
  assert.deepEqual(open.mock.calls[0].arguments, ["transformers-cache"]);
  assert.equal(report.mock.callCount(), 1);
  assert.deepEqual(report.mock.calls[0].arguments, [
    {
      operation: "cache-open",
      error: {
        name: "SecurityError",
        message: original.message,
        stack: original.stack,
      },
    },
  ]);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "online model");
});
