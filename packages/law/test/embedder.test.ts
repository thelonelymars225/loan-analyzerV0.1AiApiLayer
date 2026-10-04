import { describe, expect, it } from "vitest";
import { EMBEDDING_DIM } from "@rater/contracts";
import { cosineSimilarity, HashEmbedder } from "../src";

const norm = (vector: number[]) => Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));

describe("HashEmbedder", () => {
  const embedder = new HashEmbedder();

  it("uses the shared embedding dimension", () => {
    expect(embedder.dim).toBe(EMBEDDING_DIM);
    expect(embedder.embed("annual leave")).toHaveLength(EMBEDDING_DIM);
  });

  it("is deterministic across calls and instances", () => {
    const text = "The end-of-service award is calculated on the last actual wage.";
    expect(embedder.embed(text)).toEqual(embedder.embed(text));
    expect(new HashEmbedder().embed(text)).toEqual(embedder.embed(text));
  });

  it("returns unit-length vectors", () => {
    for (const text of ["overtime", "مكافأة نهاية الخدمة", "Art. 84 and المادة 84"]) {
      expect(norm(embedder.embed(text))).toBeCloseTo(1, 10);
    }
  });

  it("returns a zero vector for text with no words", () => {
    const vector = embedder.embed("  ... ,, ");
    expect(vector).toHaveLength(EMBEDDING_DIM);
    expect(vector.every((x) => x === 0)).toBe(true);
  });

  it("ignores Arabic decoration: tashkeel, tatweel, bidi marks and letter variants", () => {
    const plain = embedder.embed("الاجازه السنويه");
    const decorated = embedder.embed("\u200Fالإجا\u0640زةُ السَّنويّة\u200F");
    expect(cosineSimilarity(plain, decorated)).toBeCloseTo(1, 10);
  });

  it("supports a custom dimension", () => {
    expect(new HashEmbedder(64).embed("wage")).toHaveLength(64);
  });

  it("scores related texts above unrelated ones, in both languages", () => {
    const query = embedder.embed("overtime pay for additional working hours");
    const related = embedder.embed(
      "Overtime hours are paid at the hourly wage plus 50%.",
    );
    const unrelated = embedder.embed("Arabic is the official language of the contract.");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );

    const arQuery = embedder.embed("مدة التجربة");
    const arRelated = embedder.embed("لا تزيد مدة التجربة على مائة وثمانين يوما");
    const arUnrelated = embedder.embed("مكافأة نهاية الخدمة تحسب على أساس الأجر");
    expect(cosineSimilarity(arQuery, arRelated)).toBeGreaterThan(
      cosineSimilarity(arQuery, arUnrelated),
    );
  });
});
