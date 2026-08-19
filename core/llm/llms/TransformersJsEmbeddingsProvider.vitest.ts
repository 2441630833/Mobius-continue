import { describe, expect, test } from "vitest";
import TransformersJsEmbeddingsProvider, {
  setTransformersJsBackgroundPaused,
} from "./TransformersJsEmbeddingsProvider.js";

describe("TransformersJsEmbeddingsProvider", () => {
  test("returns mock vectors in test env without starting a Worker", async () => {
    const provider = new TransformersJsEmbeddingsProvider();
    const out = await provider.embed(["hello", "world"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(384);
    expect(out[0]).toEqual(TransformersJsEmbeddingsProvider.mockVector);
    expect(out[1]).toEqual(TransformersJsEmbeddingsProvider.mockVector);
  });

  test("setTransformersJsBackgroundPaused is a no-throw toggle", () => {
    setTransformersJsBackgroundPaused(true);
    setTransformersJsBackgroundPaused(false);
  });
});
