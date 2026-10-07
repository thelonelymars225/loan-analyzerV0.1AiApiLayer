import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/rater";

describe("loadConfig", () => {
  it("applies the defaults", () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      WORKER_CONCURRENCY: 2,
      OCR_ENABLED: true,
      DB_MIGRATE_ON_START: true,
      LOG_LEVEL: "info",
    });
  });

  it("reads numbers and booleans from strings", () => {
    const config = loadConfig({
      DATABASE_URL,
      WORKER_CONCURRENCY: "4",
      OCR_ENABLED: "false",
      DB_MIGRATE_ON_START: "0",
      LOG_LEVEL: "debug",
    });
    expect(config).toMatchObject({
      WORKER_CONCURRENCY: 4,
      OCR_ENABLED: false,
      DB_MIGRATE_ON_START: false,
      LOG_LEVEL: "debug",
    });
  });

  it("treats empty values as unset", () => {
    expect(
      loadConfig({ DATABASE_URL, OCR_ENABLED: "", WORKER_CONCURRENCY: " " }),
    ).toMatchObject({ OCR_ENABLED: true, WORKER_CONCURRENCY: 2 });
  });

  it("does not copy secrets into the config", () => {
    const config = loadConfig({
      DATABASE_URL,
      STORAGE_ENCRYPTION_KEY: "c2VjcmV0",
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(JSON.stringify(config)).not.toMatch(/c2VjcmV0|sk-test/);
  });

  it("explains what is wrong", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL, WORKER_CONCURRENCY: "zero" })).toThrow(
      /WORKER_CONCURRENCY/,
    );
    expect(() => loadConfig({ DATABASE_URL, OCR_ENABLED: "maybe" })).toThrow(
      /OCR_ENABLED/,
    );
  });
});
