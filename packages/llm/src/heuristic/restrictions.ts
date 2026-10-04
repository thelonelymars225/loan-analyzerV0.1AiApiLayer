import type { ClauseText, Detection } from "./detection";
import { passes, problem } from "./detection";
import { AFTER_CONTRACT_ENDS, SAUDI_PLACE, WORKER_CONSENT } from "./patterns";
import { findQuantities, formatNumber, toMonths } from "./text";

/*
 * Detectors for clauses that restrict the worker: relocation anywhere in the Kingdom
 * (TRANSFER-KSA-01), non-compete after the contract (NONCOMPETE-01) and open-ended
 * confidentiality (CONFIDENTIAL-01).
 */

// ---------------------------------------------------------------------------------------------
// TRANSFER-KSA-01: employer may relocate the worker to another city, branch, site or project
// ---------------------------------------------------------------------------------------------

const TRANSFER =
  /\btransfer\w*|\brelocat\w*|\bmov(?:e|ed|ing)\b|\breassign\w*|\bassign\w*|\bsecond(?:ed|ment)\b|\bdeploy\w*|\bpost(?:ed|ing)? (?:the employee|him|her)\b|\brotat\w*|\bchang\w* (?:the |his |her |the employee'?s )?(?:place|location|site) of work\b|\bwork(?:ing)? (?:place|location|site) may be changed\b|\b(?:place|location|site) of work (?:may|can|shall|will) be changed\b/;
const ANY_PLACE = new RegExp(
  [
    String.raw`\b(?:any|all|other|another|different)\s+(?:of\s+(?:its|the|our|the company'?s|the employer'?s)\s+)?(?:\w+\s+(?:or|and)\s+)?(?:branch(?:es)?|city|cities|sites?|locations?|projects?|regions?|offices?|places?|workplaces?|work ?sites?|facilit(?:y|ies)|provinces?|areas?)\b`,
    String.raw`\banywhere\b|\b(?:throughout|across|within|inside|in) (?:the )?(?:kingdom|ksa|saudi arabia)\b`,
  ].join("|"),
);
const SAME_CITY_ONLY = /\b(?:within|in) the same city\b|\bwithin the city of\b/;

export function detectTransfer({ text }: ClauseText): Detection | null {
  if (!TRANSFER.test(text) || !ANY_PLACE.test(text) || SAME_CITY_ONLY.test(text))
    return null;
  if (WORKER_CONSENT.test(text)) {
    return passes(
      "compliant",
      "This clause allows a transfer to another location only with the worker's agreement at the time.",
      "medium",
    );
  }
  return problem(
    "worse_than_default",
    "medium",
    "This clause lets the employer move the worker to another city, branch, site or project anywhere in the Kingdom. It is enforceable, because the regulations treat it as the worker's written consent to relocation, but it removes the worker's main protection against being moved.",
  );
}

// ---------------------------------------------------------------------------------------------
// NONCOMPETE-01: no working for a competitor after the contract ends
// ---------------------------------------------------------------------------------------------

const COMPETITION =
  /\bnon[- ]?compet\w*|\bcompetitors?\b|\bcompet(?:e|es|ing|ition)\b|\brival\w*|\bsimilar (?:business|activity|company|establishment|entity)\b|\bsame (?:line of )?(?:business|industry|activity)\b/;
const UNLIMITED_PLACE =
  /\banywhere\b|\bany (?:city|country|place|location|region|area)\b|\bworld ?wide\b|\bglobally\b|\bgcc\b/;
const LIMITED_WORK =
  /\b(?:role|position|capacity|job|post|function|line of work|type of work|field|activity|activities|duties|profession)\b/;
const UNLIMITED_WORK =
  /\bany (?:role|position|capacity|job|work|activity|form|field)\b|\bin any (?:way|manner|form)\b/;
const CLIENT_ACCESS =
  /\b(?:access to|contact with|dealings with|relationships? with|knowledge of|deal(?:s|t)? with|serv(?:e|ed|es|ing)|manag(?:e|ed|es|ing))\s+(?:the\s+)?(?:employer'?s?\s+|company'?s?\s+|its\s+|their\s+|our\s+)?(?:clients?|customers?|client base|customer base|accounts)\b/;
const NONCOMPETE_LIMIT_MONTHS = 24;

export function detectNonCompete({ text }: ClauseText): Detection | null {
  // A duty not to compete while employed is ordinary loyalty; the rule is about after the end.
  if (!COMPETITION.test(text) || !AFTER_CONTRACT_ENDS.test(text)) return null;

  const months = durationMonths(text);
  const impactParams = months === null ? undefined : { nonCompeteMonths: months };
  const placeLimited = SAUDI_PLACE.test(text) && !UNLIMITED_PLACE.test(text);
  const workLimited = LIMITED_WORK.test(text) && !UNLIMITED_WORK.test(text);
  const clientAccess = CLIENT_ACCESS.test(text);

  const gaps = [
    months === null ? "it does not say how long it lasts" : null,
    months !== null && months > NONCOMPETE_LIMIT_MONTHS
      ? `it lasts ${formatNumber(months)} months, longer than the two-year maximum`
      : null,
    placeLimited ? null : "it has no specific limit on place",
    workLimited ? null : "it has no limit on the type of work",
    clientAccess
      ? null
      : "it is not tied to the worker's access to the employer's clients",
  ].filter((gap): gap is string => gap !== null);

  if (gaps.length === 0) {
    return passes(
      "compliant",
      `This non-compete lasts ${formatNumber(months ?? 0)} months and is limited in place and type of work to a job with access to the employer's clients, as the Labor Law requires.`,
      "high",
      impactParams,
    );
  }
  const clearlyVoid =
    (months !== null && months > NONCOMPETE_LIMIT_MONTHS) || gaps.length >= 3;
  return problem(
    "likely_void",
    "high",
    `This clause stops the worker from competing after the contract ends, but ${joinGaps(gaps)}. The Labor Law allows a non-compete only for up to two years, limited in place and type of work, and where the job gives access to the employer's clients.`,
    clearlyVoid ? "high" : "medium",
    impactParams,
  );
}

/** The restriction's length in months: the first stated weeks, months or years. */
function durationMonths(text: string): number | null {
  for (const quantity of findQuantities(text)) {
    const months = toMonths(quantity);
    if (months !== null) return months;
  }
  return null;
}

function joinGaps(gaps: string[]): string {
  if (gaps.length <= 1) return gaps.join("");
  return `${gaps.slice(0, -1).join(", ")} and ${gaps[gaps.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------
// CONFIDENTIAL-01: confidentiality that runs on after the contract with no limit
// ---------------------------------------------------------------------------------------------

const CONFIDENTIALITY =
  /\bconfidential\w*|\bdisclos\w*|\bdivulg\w*|\breveal\w*|\bsecrets?\b|\bsecrecy\b|\bnon[- ]disclosure\b|\bproprietary information\b/;
const WITHOUT_TIME_LIMIT =
  /\bat any time\b|\bindefinite(?:ly)?\b|\bforever\b|\bperpetu\w*|\bwithout (?:any )?(?:time )?limit\w*|\bno time limit\b|\bunlimited\b|\bsurviv\w* (?:the )?(?:termination|expiry|end)\b|\bat all times\b/;

/**
 * A ban on passing information on, in plain words: "is not allowed to share the company's
 * information or documents", "shall not disclose any data".
 */
const NO_SHARING =
  /\b(?:not|never|nor|refrain from|prohibited from|forbidden (?:from|to))\b(?:\s+[\w'-]+){0,4}?\s+(?:share|sharing|pass(?:ing)? on|hand(?:ing)? over|give out|leak\w*|publish\w*|transmit\w*|disclos\w*|divulg\w*|reveal\w*)\b[^.;]*?\b(?:information|documents?|data|records|files|materials?|secrets?)\b/;
/** "keep ... confidential", "maintain the confidentiality of", "duty of secrecy". */
const KEEP_SECRET =
  /\bkeep\b[^.;]*?\b(?:confidential|secret)\b|\b(?:maintain|preserve|protect|observe)\b[^.;]*?\b(?:confidentiality|secrecy)\b|\bduty of (?:confidentiality|secrecy)\b|\bnon[- ]disclosure\b/;
/** The worker is the one bound, not the employer keeping the worker's own records private. */
const WORKER_BOUND = /\b(?:employee|worker|second party)\b(?!'s?\b)/;
/** Limited to the time of employment: the ordinary duty of loyalty, not this rule. */
const DURING_EMPLOYMENT_ONLY =
  /\b(?:during|throughout|for the (?:term|duration) of)\s+(?:the |his |her |their |this )?(?:employment|contract|agreement|service|term of (?:the |this )?contract)\b|\bwhile (?:employed|in (?:the )?employment|working for)\b/;

export function detectConfidentiality({ text }: ClauseText): Detection | null {
  const secrecyDuty = NO_SHARING.test(text) || KEEP_SECRET.test(text);
  if (!CONFIDENTIALITY.test(text) && !secrecyDuty) return null;
  const afterEnd = AFTER_CONTRACT_ENDS.test(text);
  const unlimited = WITHOUT_TIME_LIMIT.test(text);

  if (!afterEnd && !unlimited) {
    return silentOnTime(text, secrecyDuty)
      ? problem(
          "unclear",
          "low",
          "This confidentiality duty states no time limit at all, so it may continue after the contract ends with no end date and no limit on the kind of information covered. Keeping business secrets is a normal duty, but after the contract the Labor Law expects such a term to be specific, so its reach is unclear.",
          "medium",
        )
      : null;
  }

  const months = afterEnd ? durationMonths(text) : null;
  if (months !== null && !unlimited) {
    return passes(
      "compliant",
      `This clause keeps confidentiality for ${formatNumber(months)} months after the contract ends, which is limited in time.`,
      "medium",
    );
  }
  return problem(
    "unclear",
    "low",
    "This confidentiality duty continues after the contract ends with no limit on time or on the kind of information covered. Keeping business secrets is a normal duty, but after the contract the Labor Law expects such a term to be specific, so its reach is unclear.",
  );
}

/**
 * A worker's duty of secrecy that says nothing about how long it lasts. Such a duty has no end,
 * so it is read like one that runs on after the contract. A duty stated only for the time of
 * employment, or for a stated period, is not.
 */
function silentOnTime(text: string, secrecyDuty: boolean): boolean {
  return (
    secrecyDuty &&
    WORKER_BOUND.test(text) &&
    !DURING_EMPLOYMENT_ONLY.test(text) &&
    durationMonths(text) === null
  );
}
