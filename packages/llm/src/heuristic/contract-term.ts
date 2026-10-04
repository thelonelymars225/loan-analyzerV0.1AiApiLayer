import type { ClauseText, Detection } from "./detection";
import { passes, problem } from "./detection";
import { splitSentences } from "./text";

/*
 * What a clause says about the contract's own type and term. Used by TYPE-ART57-01 (a contract
 * tied to an undefined project) and by the cross-check (TYPE-CONFLICT-01).
 */

/** The contract types a clause can state, named as in ContractFields.contractType. */
export type StatedType = "fixed_term" | "indefinite" | "specific_work";

/** "ends upon completion of the project", "in accordance with Article 57", "project-based". */
const PROJECT_END = new RegExp(
  [
    String.raw`\b(?:end|ends|ending|ended|terminat\w*|expir\w*|conclud\w*|lapse\w*|cease\w*|last\w*|continu\w*|valid)\b[^.]*?\b(?:upon|on|with|at|by|after|until|till)\s+(?:the\s+)?(?:completion|end|conclusion|termination|expiry|expiration|finish|close|closure|delivery|handover)\s+of\s+(?:the\s+|this\s+|its\s+|that\s+)?(?:[\w'-]+\s+){0,3}?(?:project|assignment|task|engagement|programme|program|specific work|works)\b`,
    String.raw`\b(?:when|once|if) the (?:[\w'-]+\s+){0,3}?(?:project|assignment|task|engagement) (?:ends|is completed|is finished|is over|closes|is delivered|comes to an end)\b`,
    String.raw`\b(?:duration|life|term|lifetime|period) of the (?:[\w'-]+\s+){0,3}?(?:project|assignment|engagement)\b`,
    String.raw`\barticle 57\b|\bart\.? ?57\b|\bspecific (?:work|task|project)\b|\bproject[- ]based\b|\btied to the (?:[\w'-]+\s+)?project\b`,
  ].join("|"),
);

/** Wording that defines the work: its scope, deliverables, or how completion is decided. */
const WORK_DEFINED =
  /\b(?:scope|deliverables?|milestones?)\b[^.]*\b(?:defined|described|set out|specified|listed|attached)\b|\b(?:appendix|annex|schedule) \w+\b|\bcompletion (?:certificate|shall be (?:confirmed|certified|determined))\b|\bacceptance certificate\b|\bdeemed (?:complete|completed) when\b/;

const INDEFINITE = new RegExp(
  [
    String.raw`\b(?:unlimited|indefinite|unspecified|undetermined|open[- ]ended|non[- ]fixed|undefined)\s+(?:period|duration|term|time|contract)\b`,
    String.raw`\bwithout (?:a |any )?(?:fixed|specified|definite|set) (?:term|period|duration|end date)\b`,
    String.raw`\bno (?:fixed )?(?:end date|expiry date|term)\b|\bopen[- ]ended\b|\buntil (?:terminated|further notice)\b`,
  ].join("|"),
);

const FIXED_TERM = new RegExp(
  [
    String.raw`\bfixed[- ](?:term|period|duration)\b|\b(?:limited|definite|specified) (?:period|duration|term)\b`,
    String.raw`\b(?:contract|agreement|employment)(?: term)? (?:is|shall be|will be)?\s*(?:valid |concluded |made |entered into )?for (?:a (?:fixed )?(?:period|term|duration) of )?(?:\d+|one|two|three|four|five|a)(?:\s*\(\d+\))?\s*(?:years?|months?)\b`,
    String.raw`\b(?:term|duration|period) of (?:this|the) (?:contract|agreement|employment) (?:is|shall be|will be) (?:\d+|one|two|three|four|five|a)(?:\s*\(\d+\))?\s*(?:years?|months?)\b`,
    String.raw`\b(?:contract|agreement|employment) (?:shall |will )?(?:end|expire|terminate)s? on (?:\d|the date)\b`,
  ].join("|"),
);

/** A sentence about the contract itself, not about another duty's duration. */
const ABOUT_CONTRACT = /\b(?:contract|agreement|employment|engagement)\b/;
const ABOUT_OTHER_DUTY =
  /\bconfidential\w*|\bdisclos\w*|\bsecrets?\b|\bcompet\w*|\bprobation\w*|\bannual leave\b|\bovertime\b|\bend[- ]of[- ]service\b/;

/** The contract types a clause states for the contract as a whole. */
export function statedContractTypes(text: string): Set<StatedType> {
  const stated = new Set<StatedType>();
  for (const sentence of splitSentences(text)) {
    if (ABOUT_OTHER_DUTY.test(sentence)) continue;
    if (PROJECT_END.test(sentence)) stated.add("specific_work");
    if (!ABOUT_CONTRACT.test(sentence)) continue;
    if (INDEFINITE.test(sentence)) stated.add("indefinite");
    if (FIXED_TERM.test(sentence)) stated.add("fixed_term");
  }
  return stated;
}

export function detectProjectEnd({ text }: ClauseText): Detection | null {
  if (!statedContractTypes(text).has("specific_work")) return null;
  if (WORK_DEFINED.test(text)) {
    return passes(
      "compliant",
      "This clause ties the end of the contract to a defined piece of work, with its scope and how completion is decided, which the Labor Law allows.",
      "medium",
    );
  }
  return problem(
    "unclear",
    "high",
    "This clause ends the contract when a project or specific work is completed, but does not define that work: its scope, what must be delivered, or who decides it is done. That leaves the end date uncertain.",
  );
}
