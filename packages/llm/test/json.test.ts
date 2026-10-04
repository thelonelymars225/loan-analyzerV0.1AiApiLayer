import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../src/json";

describe("extractJsonObject", () => {
  const reply = { clause: "15.1", matches: [] };

  it("parses a bare JSON object", () => {
    expect(extractJsonObject(JSON.stringify(reply))).toEqual(reply);
  });

  it("parses a ```json fenced block", () => {
    expect(
      extractJsonObject("```json\n" + JSON.stringify(reply, null, 2) + "\n```"),
    ).toEqual(reply);
  });

  it("parses a fence without a language tag", () => {
    expect(extractJsonObject("```\n" + JSON.stringify(reply) + "\n```")).toEqual(reply);
  });

  it("skips prose before and after the object", () => {
    expect(
      extractJsonObject(`Here is the analysis:\n${JSON.stringify(reply)}\nDone.`),
    ).toEqual(reply);
  });

  it("ignores braces inside strings", () => {
    const tricky = {
      clause: "15.2",
      matches: [{ explanation: 'Says "{not json}" and \\ more }' }],
    };
    expect(extractJsonObject(`Result: ${JSON.stringify(tricky)} trailing }`)).toEqual(
      tricky,
    );
  });

  it("skips a broken object and takes the next complete one", () => {
    expect(extractJsonObject(`{ not json } then ${JSON.stringify(reply)}`)).toEqual(
      reply,
    );
  });

  it.each([
    "",
    "No JSON here.",
    "[1, 2, 3]",
    '"just a string"',
    '{"clause": "15.1", "matches": [',
  ])("returns undefined for %j", (text) => {
    expect(extractJsonObject(text)).toBeUndefined();
  });
});
