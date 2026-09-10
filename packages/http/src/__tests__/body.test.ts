import { isFailure, isSuccess } from "@comity/primitives/result";
import { describe, expect, it } from "vitest";
import { readJsonBody, type ReadJsonBodyOptions } from "../body.js";
import { HttpBodyError } from "../errors/body.js";

function createStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

function createStreamFromString(str: string): ReadableStream<Uint8Array> {
  return createStream([new TextEncoder().encode(str)]);
}

function createMultiChunkStream(str: string, chunkSize: number): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(str);
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < encoded.length; i += chunkSize) {
    chunks.push(encoded.slice(i, i + chunkSize));
  }

  return createStream(chunks);
}

describe("readJsonBody", () => {
  const defaultOptions: ReadJsonBodyOptions = { maxBytes: 1024 };

  it("returns empty_body error for null rawBody", async () => {
    const result = await readJsonBody(null, defaultOptions);

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error).toBeInstanceOf(HttpBodyError);
      expect(result.error.code).toBe("http:empty_body");
      expect(result.error.meta.httpStatus).toBe(400);
    }
  });

  it("returns empty_body error for undefined rawBody", async () => {
    const result = await readJsonBody(undefined, defaultOptions);

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:empty_body");
    }
  });

  it("returns empty_body error for empty stream", async () => {
    const stream = createStream([]);
    const result = await readJsonBody(stream, defaultOptions);

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:empty_body");
    }
  });

  it("returns empty_body error for whitespace-only stream", async () => {
    const stream = createStreamFromString("   \n\t  ");
    const result = await readJsonBody(stream, defaultOptions);

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:empty_body");
    }
  });

  it("parses valid JSON object", async () => {
    const stream = createStreamFromString('{"name": "test", "value": 42}');
    const result = await readJsonBody(stream, defaultOptions);

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      expect(result.value).toEqual({ name: "test", value: 42 });
    }
  });

  it("parses valid JSON array", async () => {
    const stream = createStreamFromString('[1, 2, 3, "four"]');
    const result = await readJsonBody(stream, defaultOptions);

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      expect(result.value).toEqual([1, 2, 3, "four"]);
    }
  });

  it("parses JSON primitive values", async () => {
    const stream = createStreamFromString('"hello world"');
    const result = await readJsonBody(stream, defaultOptions);

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      expect(result.value).toBe("hello world");
    }
  });

  it("parses nested JSON", async () => {
    const stream = createStreamFromString('{"outer": {"inner": {"deep": true}}}');
    const result = await readJsonBody(stream, defaultOptions);

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      expect(result.value).toEqual({ outer: { inner: { deep: true } } });
    }
  });

  it("returns body_too_large error when exceeding maxBytes", async () => {
    const largeJson = '{"data": "' + "x".repeat(2000) + '"}';
    const stream = createStreamFromString(largeJson);
    const result = await readJsonBody(stream, { maxBytes: 100 });

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:body_too_large");
      expect(result.error.meta.httpStatus).toBe(413);
      expect(result.error.meta.details?.maxBytes).toBe(100);
      expect(result.error.meta.details?.actualBytes).toBeGreaterThan(100);
    }
  });

  it("accepts exactly maxBytes", async () => {
    const json = '{"a": 1}';
    const stream = createStreamFromString(json);
    const result = await readJsonBody(stream, { maxBytes: json.length });

    expect(isSuccess(result)).toBe(true);
  });

  it("rejects one byte over maxBytes", async () => {
    const json = '{"a": 1}';
    const stream = createStreamFromString(json);
    const result = await readJsonBody(stream, { maxBytes: json.length - 1 });

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:body_too_large");
    }
  });

  it("returns invalid_json error for malformed JSON", async () => {
    const stream = createStreamFromString('{"invalid": json}');
    const result = await readJsonBody(stream, defaultOptions);

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:invalid_json");
      expect(result.error.meta.httpStatus).toBe(400);
    }
  });

  it("handles UTF-8 multi-byte characters split across chunks", async () => {
    const emoji = "🎉";
    const json = `{"emoji": "${emoji}"}`;
    const stream = createMultiChunkStream(json, 5);
    const result = await readJsonBody(stream, defaultOptions);

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      expect(result.value).toEqual({ emoji });
    }
  });

  it("handles multi-byte characters at chunk boundaries", async () => {
    const json = '{"text": "hello 🌍 world"}';
    const stream = createMultiChunkStream(json, 10);
    const result = await readJsonBody(stream, defaultOptions);

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      expect(result.value).toEqual({ text: "hello 🌍 world" });
    }
  });

  it("uses default maxBytes of 1 MiB when not specified", async () => {
    const json = '{"data": "test"}';
    const stream = createStreamFromString(json);
    const result = await readJsonBody(stream);

    expect(isSuccess(result)).toBe(true);
  });

  it("releases reader lock on oversized body", async () => {
    const largeJson = '{"data": "' + "x".repeat(2000) + '"}';
    const stream = createStreamFromString(largeJson);
    const result = await readJsonBody(stream, { maxBytes: 100 });

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:body_too_large");
    }
  });

  it("distinguishes empty body from malformed JSON", async () => {
    const emptyResult = await readJsonBody(createStream([]), defaultOptions);
    const malformedResult = await readJsonBody(createStreamFromString("{invalid}"), defaultOptions);

    expect(isFailure(emptyResult)).toBe(true);
    expect(isFailure(malformedResult)).toBe(true);

    if (isFailure(emptyResult) && isFailure(malformedResult)) {
      expect(emptyResult.error.code).toBe("http:empty_body");
      expect(malformedResult.error.code).toBe("http:invalid_json");
    }
  });

  it("rejects negative maxBytes", async () => {
    const stream = createStreamFromString('{"a": 1}');
    const result = await readJsonBody(stream, { maxBytes: -1 });

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:body_too_large");
    }
  });

  it("rejects zero maxBytes for non-empty body", async () => {
    const stream = createStreamFromString('{"a": 1}');
    const result = await readJsonBody(stream, { maxBytes: 0 });

    expect(isFailure(result)).toBe(true);

    if (isFailure(result)) {
      expect(result.error.code).toBe("http:body_too_large");
    }
  });
});
