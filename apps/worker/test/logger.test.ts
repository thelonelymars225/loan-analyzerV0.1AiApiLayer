import { describe, expect, it } from "vitest";
import { errorForLog } from "../src/logger";

describe("errorForLog", () => {
  it("keeps name, message, code and stack, and drops row details", () => {
    // Shaped like a pg DatabaseError, whose `detail` can echo the failed row.
    const error = Object.assign(new Error("null value in column violates not-null"), {
      code: "23502",
      detail: "Failing row contains (cl_1, The employee shall not ...).",
    });
    const logged = errorForLog(error);
    expect(logged).toMatchObject({
      name: "Error",
      message: "null value in column violates not-null",
      code: "23502",
    });
    expect(logged.stack).toEqual(expect.any(String));
    expect(JSON.stringify(logged)).not.toContain("Failing row");
  });

  it("handles values that are not errors", () => {
    expect(errorForLog("boom")).toEqual({ message: "boom" });
  });
});
