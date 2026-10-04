import { describe, expect, it } from "vitest";
import {
  analyseSection15,
  clauseCacheKey,
  clauseCandidates,
  crossCheckSection15,
  formatCitation,
  MemoryClauseCache,
  type Section15Input,
} from "../../src/section15";
import {
  analysis,
  clause,
  FakeArticleLookup,
  FakeLlmClient,
  lawArticle,
  match,
  RULES,
  TEST1_CLAUSES,
  TEST1_CROSS,
  TEST1_REPLIES,
  test1Fields,
} from "./fixtures";

const VERSIONS = { law: "2025-11", ruleset: "0.1.0" };
const EOS_CLAUSE = clause(
  "15.6",
  "The end-of-service award shall be calculated on the basis of the basic salary only.",
);

function setup(llm: FakeLlmClient, overrides: Partial<Section15Input> = {}) {
  const input: Section15Input = {
    clauses: [EOS_CLAUSE],
    fields: test1Fields(),
    rules: RULES,
    llm,
    articles: new FakeArticleLookup(),
    cache: new MemoryClauseCache(),
    versions: VERSIONS,
    ...overrides,
  };
  return input;
}

const eosReply = analysis(
  "15.6",
  match("EOS-BASE-01", "likely_void", "high", { impactParams: { eosBase: "basic" } }),
);

describe("formatCitation", () => {
  it("formats each source the way rules cite it", () => {
    expect(formatCitation(lawArticle("labor_law", "84"))).toBe("Art. 84");
    expect(formatCitation(lawArticle("labor_law", "83", "1"))).toBe("Art. 83(1)");
    expect(formatCitation(lawArticle("implementing_regulations", "20"))).toBe(
      "Exec. Reg. Art. 20",
    );
    expect(formatCitation(lawArticle("qiwa_template", "14.5"))).toBe("Contract cl. 14.5");
  });
});

describe("clauseCacheKey", () => {
  const v = { law: "2025-11", ruleset: "0.1.0", prompt: "s15-v1", model: "m" };

  it("changes with the text and with every version", () => {
    const key = clauseCacheKey(EOS_CLAUSE, v);
    expect(key).toContain(EOS_CLAUSE.textHash);
    expect(clauseCacheKey(clause("15.6", "Another text."), v)).not.toBe(key);
    for (const field of ["law", "ruleset", "prompt", "model"] as const) {
      expect(clauseCacheKey(EOS_CLAUSE, { ...v, [field]: "other" })).not.toBe(key);
    }
  });

  it("does not depend on the clause number", () => {
    expect(clauseCacheKey({ ...EOS_CLAUSE, number: "15.1" }, v)).toBe(
      clauseCacheKey(EOS_CLAUSE, v),
    );
  });
});

describe("clauseCandidates", () => {
  it("is the clause rules plus the field rules that say what to detect", () => {
    expect(clauseCandidates(RULES).map((r) => r.id)).toEqual([
      "PROB-MAX-01",
      "LEAVE-MIN-01",
      "LEAVE-FORFEIT-01",
      "HOURS-MAX-01",
      "OT-RATE-01",
      "EOS-BASE-01",
      "COMP-ART77-01",
      "TYPE-ART57-01",
      "TRANSFER-KSA-01",
      "NONCOMPETE-01",
      "CONFIDENTIAL-01",
    ]);
  });
});

describe("analyseSection15", () => {
  it("turns a valid reply into findings with the rule's texts and the analyser's verdict", async () => {
    const llm = new FakeLlmClient({ clauses: { "15.6": [eosReply] } });
    const { findings, usage } = await analyseSection15(setup(llm));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "EOS-BASE-01",
      clause: "15.6",
      verdict: "likely_void",
      severity: "high",
      confidence: "high",
      categories: ["legal"],
      articles: ["Art. 2", "Art. 84", "Art. 8"],
      explanation: "EOS-BASE-01 explanation.",
      employeeMsg: "Likely void: end-of-service uses your actual wage.",
      askFor: "Ask for the award on your actual wage.",
      suggestedWording: "The award is calculated on the last actual wage.",
      source: "clause",
      needsReview: false,
      impactParams: { eosBase: "basic" },
      impactKind: "eos_gap",
    });
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("sends the redacted clause, the field summary, the candidate rules and their articles", async () => {
    const lookup = new FakeArticleLookup();
    lookup.searchResults = [
      lawArticle("labor_law", "65", "6"),
      lawArticle("labor_law", "84"),
    ];
    const llm = new FakeLlmClient();
    await analyseSection15(setup(llm, { articles: lookup }));

    const request = llm.clauseRequests[0]!;
    expect(request.clause).toEqual({
      number: "15.6",
      textEn: EOS_CLAUSE.textEn,
      textAr: null,
    });
    expect(request.fieldSummary).toContain("Contract type: fixed-term.");
    expect(request.candidateRules.map((r) => r.id)).toContain("EOS-BASE-01");
    expect(request.candidateRules.map((r) => r.id)).not.toContain("TYPE-CONFLICT-01");
    expect(request.candidateRules.find((r) => r.id === "EOS-BASE-01")?.detect).toBe(
      "End-of-service on basic salary only",
    );
    const citations = request.articles.map((a) => a.citation);
    expect(citations).toContain("Art. 84");
    expect(citations).toContain("Art. 65(6)"); // found by search only
    expect(citations.filter((c) => c === "Art. 84")).toHaveLength(1); // by rule and by search, sent once
    expect(lookup.searches).toEqual([EOS_CLAUSE.textEn]);
    expect(request.previousError).toBeUndefined();
  });

  it("caches a valid analysis and answers the same clause from the cache next time", async () => {
    const cache = new MemoryClauseCache();
    const first = new FakeLlmClient({ clauses: { "15.6": [eosReply] } });
    await analyseSection15(setup(first, { cache }));
    expect(cache.size).toBe(1);

    const second = new FakeLlmClient();
    const { findings, usage } = await analyseSection15(
      setup(second, { cache, clauses: [{ ...EOS_CLAUSE, number: "15.2" }] }),
    );
    expect(second.clauseRequests).toHaveLength(0);
    expect(findings[0]).toMatchObject({ ruleId: "EOS-BASE-01", clause: "15.2" });
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("ignores a cached value that is not a valid analysis", async () => {
    const cache = new MemoryClauseCache();
    const llm = new FakeLlmClient({ clauses: { "15.6": [eosReply] } });
    const key = clauseCacheKey(EOS_CLAUSE, {
      ...VERSIONS,
      prompt: llm.promptVersion,
      model: llm.model,
    });
    await cache.set(key, { clause: "15.6", matches: [{ ruleId: "GONE-01" }] });
    const { findings } = await analyseSection15(setup(llm, { cache }));
    expect(llm.clauseRequests).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("EOS-BASE-01");
  });

  it("retries once with the error after an invalid reply, then uses the valid one", async () => {
    const llm = new FakeLlmClient({
      clauses: { "15.6": [{ clause: "15.6" }, eosReply] },
    });
    const { findings, usage } = await analyseSection15(setup(llm));
    expect(llm.clauseRequests).toHaveLength(2);
    expect(llm.clauseRequests[1]?.previousError).toContain("ClauseAnalysis schema");
    expect(findings[0]?.ruleId).toBe("EOS-BASE-01");
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("raises one REVIEW-00 finding after two invalid replies, and caches nothing", async () => {
    const cache = new MemoryClauseCache();
    const llm = new FakeLlmClient({ clauses: { "15.6": ["not json at all"] } });
    const { findings } = await analyseSection15(setup(llm, { cache }));
    expect(llm.clauseRequests).toHaveLength(2);
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "REVIEW-00",
        clause: "15.6",
        verdict: "unclear",
        severity: "low",
        confidence: "low",
        needsReview: true,
      }),
    ]);
    expect(cache.size).toBe(0);
  });

  it("rejects a citation that was not provided", async () => {
    const badCitation = analysis(
      "15.6",
      match("EOS-BASE-01", "likely_void", "high", { articles: ["Art. 999"] }),
    );
    const llm = new FakeLlmClient({ clauses: { "15.6": [badCitation, eosReply] } });
    const { findings } = await analyseSection15(setup(llm));
    expect(llm.clauseRequests[1]?.previousError).toContain('Citation "Art. 999"');
    expect(findings[0]?.articles).toEqual(["Art. 2", "Art. 84", "Art. 8"]);
  });

  it("accepts a citation that only came from the search backstop", async () => {
    const lookup = new FakeArticleLookup();
    lookup.searchResults = [lawArticle("labor_law", "65", "6")];
    const reply = analysis(
      "15.6",
      match("CONFIDENTIAL-01", "unclear", "low", { articles: ["Art. 65(6)"] }),
    );
    const llm = new FakeLlmClient({ clauses: { "15.6": [reply] } });
    const { findings } = await analyseSection15(setup(llm, { articles: lookup }));
    expect(findings[0]).toMatchObject({
      ruleId: "CONFIDENTIAL-01",
      articles: ["Art. 65(6)"],
    });
  });

  it("rejects a rule that is not a candidate for clauses", async () => {
    const crossRule = analysis("15.6", match("TYPE-CONFLICT-01", "conflict", "high"));
    const llm = new FakeLlmClient({ clauses: { "15.6": [crossRule] } });
    const { findings } = await analyseSection15(setup(llm));
    expect(llm.clauseRequests[1]?.previousError).toContain(
      'Rule "TYPE-CONFLICT-01" is not one of the candidate rules',
    );
    expect(findings[0]?.ruleId).toBe("REVIEW-00");
  });

  it("treats a call that throws like an invalid reply", async () => {
    const llm = new FakeLlmClient({
      clauses: { "15.6": [new Error("overloaded"), eosReply] },
    });
    const { findings } = await analyseSection15(setup(llm));
    expect(llm.clauseRequests[1]?.previousError).toContain("overloaded");
    expect(findings[0]?.ruleId).toBe("EOS-BASE-01");
  });

  it("keeps a compliant match as a passing finding without severity, ask or wording", async () => {
    const reply = analysis("15.6", match("EOS-BASE-01", "compliant", "high"));
    const llm = new FakeLlmClient({ clauses: { "15.6": [reply] } });
    const { findings } = await analyseSection15(setup(llm));
    expect(findings[0]).toMatchObject({
      verdict: "compliant",
      severity: "none",
      employeeMsg: "End-of-service award on the actual wage",
    });
    expect(findings[0]?.askFor).toBeUndefined();
  });

  it("uses the rule's articles when the analyser cites none, and drops duplicate matches", async () => {
    const reply = analysis(
      "15.6",
      match("EOS-BASE-01", "likely_void", "high", { articles: [] }),
      match("EOS-BASE-01", "unclear", "low"),
    );
    const llm = new FakeLlmClient({ clauses: { "15.6": [reply] } });
    const { findings } = await analyseSection15(setup(llm));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verdict: "likely_void",
      articles: ["Art. 2", "Art. 84", "Art. 8"],
    });
  });

  it("analyses every clause, keeps clause order and skips empty clauses", async () => {
    const llm = new FakeLlmClient({ clauses: TEST1_REPLIES });
    const clauses = [...TEST1_CLAUSES, clause("15.8", "  ")];
    const { findings, usage } = await analyseSection15(setup(llm, { clauses }));
    expect(findings.map((f) => `${f.ruleId}@${f.clause}`)).toEqual([
      "TYPE-ART57-01@15.1",
      "CONFIDENTIAL-01@15.2",
      "TRANSFER-KSA-01@15.3",
      "COMP-ART77-01@15.4",
      "LEAVE-FORFEIT-01@15.5",
      "EOS-BASE-01@15.6",
    ]);
    expect(llm.clauseRequests).toHaveLength(7);
    expect(usage.inputTokens).toBe(700);
  });

  it("does nothing without clauses", async () => {
    const llm = new FakeLlmClient();
    const result = await analyseSection15(setup(llm, { clauses: [] }));
    expect(result).toEqual({ findings: [], usage: { inputTokens: 0, outputTokens: 0 } });
    expect(llm.clauseRequests).toHaveLength(0);
  });
});

describe("crossCheckSection15", () => {
  it("sends every clause with the cross rules and turns conflicts into findings", async () => {
    const llm = new FakeLlmClient({ cross: TEST1_CROSS });
    const { findings } = await crossCheckSection15(
      setup(llm, { clauses: TEST1_CLAUSES }),
    );

    const request = llm.crossRequests[0]!;
    expect(request.clauses.map((c) => c.number)).toEqual(
      TEST1_CLAUSES.map((c) => c.number),
    );
    expect(request.candidateRules.map((r) => r.id)).toEqual(["TYPE-CONFLICT-01"]);
    expect(request.articles.map((a) => a.citation)).toEqual([
      "Contract cl. 14.5",
      "Art. 74",
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "TYPE-CONFLICT-01",
        clause: "15.1",
        verdict: "conflict",
        severity: "high",
        categories: ["legal", "clarity"],
        source: "cross_check",
        explanation:
          "Contradicts clause 1. Section 1 says fixed-term; 15.1 says unlimited period.",
      }),
    ]);
  });

  it("rejects a conflict on a clause that was not sent, then falls back to REVIEW-00", async () => {
    const reply = structuredClone(TEST1_CROSS[0]) as { conflicts: { clause: string }[] };
    reply.conflicts[0]!.clause = "15.9";
    const llm = new FakeLlmClient({ cross: [reply] });
    const { findings, usage } = await crossCheckSection15(
      setup(llm, { clauses: TEST1_CLAUSES }),
    );
    expect(llm.crossRequests[1]?.previousError).toContain('Clause "15.9"');
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "REVIEW-00",
        clause: null,
        source: "cross_check",
        needsReview: true,
      }),
    ]);
    expect(usage.inputTokens).toBe(200);
  });

  it("returns no findings when nothing conflicts", async () => {
    const llm = new FakeLlmClient();
    const { findings } = await crossCheckSection15(
      setup(llm, { clauses: TEST1_CLAUSES }),
    );
    expect(findings).toEqual([]);
    expect(llm.crossRequests).toHaveLength(1);
  });

  it("makes no call without clauses or without cross rules", async () => {
    const llm = new FakeLlmClient();
    await crossCheckSection15(setup(llm, { clauses: [] }));
    await crossCheckSection15(
      setup(llm, { rules: RULES.filter((r) => r.kind !== "cross") }),
    );
    expect(llm.crossRequests).toHaveLength(0);
  });
});
