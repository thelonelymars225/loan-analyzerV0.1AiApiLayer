import type { ContractFields, Deadline, Finding } from "@rater/contracts";
import { applyImpact } from "../../src/impact";
import { runFieldRules } from "../../src/rules";
import {
  analyseSection15,
  crossCheckSection15,
  MemoryClauseCache,
} from "../../src/section15";
import {
  FakeArticleLookup,
  FakeLlmClient,
  RULES,
  TEST1_CLAUSES,
  TEST1_CROSS,
  TEST1_REPLIES,
  TODAY,
  test1Fields,
} from "./fixtures";

/**
 * Runs steps 4a-5 on the test #1 calibration contract with a scripted analyser and returns
 * the findings in pipeline order: field rules, Section 15 clause by clause, cross-check.
 */
export async function rateTest1(
  fields: ContractFields = test1Fields(),
): Promise<{ findings: Finding[]; deadlines: Deadline[] }> {
  const llm = new FakeLlmClient({ clauses: TEST1_REPLIES, cross: TEST1_CROSS });
  const input = {
    clauses: TEST1_CLAUSES,
    fields,
    rules: RULES,
    llm,
    articles: new FakeArticleLookup(),
    cache: new MemoryClauseCache(),
    versions: { law: "2025-11", ruleset: "0.1.0" },
  };
  const field = runFieldRules(fields, RULES, { today: TODAY });
  const section15 = await analyseSection15(input);
  const cross = await crossCheckSection15(input);
  const analysed = [
    ...field.findings.map((f) => ({
      ...f,
      impactKind: RULES.find((r) => r.id === f.ruleId)?.impact,
    })),
    ...section15.findings,
    ...cross.findings,
  ];
  return { findings: applyImpact(analysed, fields), deadlines: field.deadlines };
}
