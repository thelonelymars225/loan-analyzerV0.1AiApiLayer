import type { Rule, Verdict } from "@rater/contracts";
import { canFill, fillPlaceholders, type PlaceholderValues } from "./placeholders";
import { isProblemVerdict } from "./verdicts";

export interface FindingText {
  employeeMsg: string;
  hrMsg: string;
  askFor?: string;
  suggestedWording?: string;
}

/**
 * The texts a finding carries. A rule's employeeMsg and hrMsg describe a problem (or, for info
 * rules, the information itself). A finding that passes uses the rule's goodMsg for the employee,
 * or the rule title when a value for the goodMsg is missing, and the title for HR. Only problems
 * get "what to ask for" and suggested wording.
 */
export function findingText(
  rule: Rule,
  verdict: Verdict,
  values: PlaceholderValues = {},
): FindingText {
  if (rule.kind === "info") {
    return {
      employeeMsg: fillPlaceholders(rule.employeeMsg, values),
      hrMsg: fillPlaceholders(rule.hrMsg, values),
    };
  }
  if (isProblemVerdict(verdict)) {
    return {
      employeeMsg: fillPlaceholders(rule.employeeMsg, values),
      hrMsg: fillPlaceholders(rule.hrMsg, values),
      askFor: rule.askFor,
      suggestedWording: rule.suggestedWording,
    };
  }
  const goodMsg =
    rule.goodMsg && canFill(rule.goodMsg, values)
      ? fillPlaceholders(rule.goodMsg, values)
      : rule.title;
  return { employeeMsg: goodMsg, hrMsg: rule.title };
}
