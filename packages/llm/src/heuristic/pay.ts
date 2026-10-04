import type { ImpactParams } from "@rater/contracts";
import type { ClauseText, Detection } from "./detection";
import { passes, problem } from "./detection";
import { ACTUAL_WAGE, BASIC_WAGE, LAW_REFERENCE, WORKER_CONSENT } from "./patterns";
import { findPercentages, findQuantities, formatNumber, toMonths } from "./text";

/*
 * Detectors for clauses about money: the end-of-service base (EOS-BASE-01), fixed
 * compensation for ending the contract (COMP-ART77-01) and overtime pay (OT-RATE-01).
 */

// ---------------------------------------------------------------------------------------------
// EOS-BASE-01: end-of-service award calculated on less than the last actual wage
// ---------------------------------------------------------------------------------------------

const END_OF_SERVICE =
  /\bend[- ]of[- ]service\b|\beos\b|\bgratuity\b|\bservice (?:award|benefits?|reward|bonus|indemnity)\b|\bseverance\b|\bterminal benefits?\b/;
const BASIC_PLUS_ALL_ALLOWANCES =
  /\b(?:basic|base)\s+(?:monthly\s+)?(?:salary|wage|pay)\s+(?:plus|and|including|inclusive of|together with|in addition to)\s+(?:all\s+)?(?:the\s+|its\s+|fixed\s+|regular\s+)*allowances\b/;
const BASIC_PLUS_ONE_ALLOWANCE =
  /\b(?:basic|base)\s+(?:monthly\s+)?(?:salary|wage|pay)\s+(?:plus|and|including|together with|in addition to)\s+(?:the\s+)?(?:housing|transport(?:ation)?|food|phone|mobile|living)\b/;
const EXCLUDING_ALLOWANCES =
  /\b(?:excluding|without|exclusive of|not including|apart from)\s+(?:any\s+|all\s+|the\s+)?(?:allowances|housing|transport(?:ation)? allowance)\b/;

type EosBase = NonNullable<ImpactParams["eosBase"]>;

/** What the clause bases the award on, or null when it does not say. */
function eosBaseOf(text: string): EosBase | null {
  if (BASIC_PLUS_ALL_ALLOWANCES.test(text)) return "actual";
  if (BASIC_PLUS_ONE_ALLOWANCE.test(text)) return "other";
  if (BASIC_WAGE.test(text)) return "basic";
  if (EXCLUDING_ALLOWANCES.test(text)) return "basic";
  if (ACTUAL_WAGE.test(text)) return "actual";
  return null;
}

export function detectEosBase({ text }: ClauseText): Detection | null {
  if (!END_OF_SERVICE.test(text)) return null;
  const base = eosBaseOf(text);
  switch (base) {
    case "basic":
      return problem(
        "likely_void",
        "high",
        "This clause calculates the end-of-service award on the basic salary only. The Labor Law calculates it on the last actual wage, which includes allowances, and a term that reduces a worker's legal rights is void.",
        "high",
        { eosBase: "basic" },
      );
    case "other":
      return problem(
        "likely_void",
        "high",
        "This clause calculates the end-of-service award on the basic salary plus only some allowances. The Labor Law calculates it on the last actual wage, so a smaller base reduces the award and is likely void.",
        "medium",
        { eosBase: "other" },
      );
    case "actual":
      return passes(
        "compliant",
        "This clause calculates the end-of-service award on the last actual wage, as the Labor Law requires.",
        "high",
        { eosBase: "actual" },
      );
    case null:
      return LAW_REFERENCE.test(text)
        ? passes(
            "compliant",
            "This clause leaves the end-of-service award to the Labor Law, which calculates it on the last actual wage.",
            "medium",
          )
        : null;
  }
}

// ---------------------------------------------------------------------------------------------
// COMP-ART77-01: fixed compensation for ending the contract without a valid reason
// ---------------------------------------------------------------------------------------------

const COMPENSATION =
  /\bcompensat\w*|\bindemni\w*|\bdamages\b|\bpenalty\b|\bpay (?:to )?the other party\b/;
const ENDING_CONTRACT =
  /\bterminat\w*|\bend(?:s|ed|ing)?\b|\bcancel\w*|\brescind\w*|\bdismiss\w*|\bbreak(?:s|ing)?\b|\bfire[sd]?\b|\barticle 77\b|\bart\.? ?77\b/;
const WITHOUT_VALID_REASON = new RegExp(
  [
    String.raw`\bwithout (?:a |any )?(?:(?:valid|legitimate|lawful|legal|good|justified|acceptable|reasonable|proper) )?(?:reason|cause|grounds?|justification)\b`,
    String.raw`\bfor no (?:valid |legitimate )?reason\b`,
    String.raw`\bbefore (?:its |the )?(?:expiry|expiration|end of (?:the |its )?term)\b`,
    String.raw`\bearly\b|\bprematurely\b|\billegitimate\b|\bunlawful(?:ly)?\b|\bunjustified\b`,
    String.raw`\barticle 77\b|\bart\.? ?77\b`,
  ].join("|"),
);
const REST_OF_TERM =
  /\b(?:remaining|remainder of the|rest of the|unexpired) (?:period|term|months|duration)\b|\bwages? for the (?:rest|remainder) of\b/;
const FIXED_SUM = /\b(?:sar|sr|riyals?)\b\s*[\d,]+|[\d,]+\s*(?:sar|sr|riyals?)\b/;

export function detectArt77Compensation({ text }: ClauseText): Detection | null {
  const compensation = COMPENSATION.exec(text);
  if (!compensation || !ENDING_CONTRACT.test(text) || !WITHOUT_VALID_REASON.test(text)) {
    return null;
  }
  const afterCompensation = text.slice(compensation.index);

  if (REST_OF_TERM.test(afterCompensation)) {
    return passes(
      "compliant",
      "This clause pays the wages for the rest of the term, which is what the Labor Law gives when the contract fixes no amount.",
      "medium",
    );
  }

  const months = firstMonths(afterCompensation);
  if (months !== null) {
    const base = BASIC_WAGE.test(afterCompensation) ? "basic" : "actual";
    const wage = base === "basic" ? "basic wage" : "total wage";
    return problem(
      "worse_than_default",
      "medium",
      `This clause fixes the compensation for ending the contract without a valid reason at ${formatNumber(months)} month(s) of ${wage}. The law allows the contract to fix this amount, but without it the compensation would be the wages for the rest of the term, which is usually more.`,
      "high",
      { compensationMonths: months, compensationBase: base },
    );
  }

  if (FIXED_SUM.test(afterCompensation)) {
    return problem(
      "worse_than_default",
      "medium",
      "This clause fixes the compensation for ending the contract without a valid reason at a set sum. The law allows this, but without it the compensation would be the wages for the rest of the term, which is usually more.",
      "medium",
    );
  }

  return LAW_REFERENCE.test(text)
    ? passes(
        "compliant",
        "This clause leaves the compensation for ending the contract to the Labor Law.",
        "medium",
      )
    : null;
}

/** The first "N months" or "N years" in the text, in months. */
function firstMonths(text: string): number | null {
  for (const quantity of findQuantities(text)) {
    const months = toMonths(quantity);
    if (months !== null && quantity.unit !== "week") return months;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// OT-RATE-01: overtime paid below the legal rate, or replaced by time off without consent
// ---------------------------------------------------------------------------------------------

const OVERTIME =
  /\bover[- ]?time\b|\b(?:extra|additional|longer) (?:working )?hours\b|\bhours (?:beyond|above|in excess of|exceeding|outside)\b|\bbeyond (?:the )?(?:normal|regular|official|standard|contractual|ordinary) (?:working )?hours\b|\boutside (?:the )?(?:normal|regular|official|standard) (?:working )?hours\b/;
const TIME_OFF_INSTEAD =
  /\btime[- ]off\b|\bin lieu\b|\bcompensatory (?:leave|time|days?|rest|holidays?)\b|\bdays? off\b|\bleave instead\b|\binstead of (?:overtime )?(?:pay|payment)\b/;
const NOT_PAID = new RegExp(
  [
    String.raw`\bwithout (?:any )?(?:additional |extra |further |separate )?(?:pay|payment|compensation|remuneration|wage)\b`,
    String.raw`\bno (?:additional |extra |further |separate )?(?:pay|payment|compensation|remuneration)\b`,
    String.raw`\bnot (?:be )?(?:paid|compensated|remunerated)\b|\bunpaid\b`,
    String.raw`\b(?:included|covered|compensated) (?:in|by) (?:the )?(?:monthly |basic |total |agreed )?(?:salary|wage|pay)\b`,
    String.raw`\b(?:salary|wage) (?:includes|covers|is inclusive of) (?:all |any )?over[- ]?time\b`,
  ].join("|"),
);
const TIME_AND_A_HALF =
  /\btime and a half\b|\b(?:one and a half|1\.5) times\b|\bdouble (?:time|the hourly|pay)\b|\btwice the\b/;
const PAY_UNDECIDED =
  /\b(?:company|employer'?s?|internal|hr) (?:policy|policies|rules|regulations|discretion)\b|\bat the (?:discretion|sole discretion) of the (?:employer|company)\b|\bas (?:the employer|the company|management) (?:decides|determines|sees fit)\b/;
const REQUIRED_WHEN_NEEDED =
  /\b(?:whenever|when|as|if)\b[^.]*\b(?:requir\w*|needs?|necessary|demands?|requested|instructed|asked)\b|\b(?:shall|must|will) (?:work|be available|perform)\b|\bobliged to\b|\bmay be (?:required|asked|instructed)\b/;

const LEGAL_RATE = "the hourly wage plus at least 50% of the basic hourly wage";

export function detectOvertimeRate({ text }: ClauseText): Detection | null {
  if (!OVERTIME.test(text)) return null;

  if (TIME_OFF_INSTEAD.test(text)) {
    return WORKER_CONSENT.test(text)
      ? passes(
          "compliant",
          "This clause offers time off instead of overtime pay only with the worker's consent, which the Labor Law allows.",
          "medium",
        )
      : problem(
          "likely_void",
          "high",
          `This clause replaces overtime pay with time off without the worker's consent. The Labor Law requires overtime to be paid at ${LEGAL_RATE}; paid time off instead is allowed only if the worker agrees.`,
        );
  }

  if (NOT_PAID.test(text)) {
    return problem(
      "likely_void",
      "high",
      `This clause makes overtime unpaid or already covered by the salary. The Labor Law requires overtime to be paid at ${LEGAL_RATE}.`,
    );
  }

  const premium = overtimePremium(text);
  if (premium !== null) return premiumDetection(premium.value, premium.confidence);

  if (TIME_AND_A_HALF.test(text)) {
    return passes(
      "compliant",
      `This clause pays overtime at time and a half or more, which meets ${LEGAL_RATE}.`,
    );
  }

  if (LAW_REFERENCE.test(text) || /\barticle 107\b|\bart\.? ?107\b/.test(text)) {
    return passes(
      "compliant",
      "This clause pays overtime as the Labor Law requires.",
      "medium",
    );
  }

  if (PAY_UNDECIDED.test(text)) {
    return problem(
      "unclear",
      "medium",
      `This clause leaves overtime pay to the employer's policy or discretion. The Labor Law requires ${LEGAL_RATE}, whatever the policy says.`,
    );
  }

  if (REQUIRED_WHEN_NEEDED.test(text)) {
    return problem(
      "unclear",
      "medium",
      `This clause requires extra hours when the work needs them but does not say they are paid as overtime. The Labor Law requires overtime pay of ${LEGAL_RATE}.`,
    );
  }
  return null;
}

/**
 * The overtime premium a percentage states. "150% of the hourly wage" is the wage plus 50%;
 * a percentage of 100 or less is read as the premium itself ("plus 50%", "25% of the basic
 * hourly wage"), which is how these clauses are usually written.
 */
function overtimePremium(
  text: string,
): { value: number; confidence: "high" | "medium" } | null {
  const percent = findPercentages(text)[0];
  if (percent === undefined) return null;
  if (percent > 100) return { value: percent - 100, confidence: "high" };
  const saysPlus = /\bplus\b|\bin addition\b|\badditional\b|\bpremium\b|\bon top\b/.test(
    text,
  );
  return { value: percent, confidence: saysPlus || percent < 50 ? "high" : "medium" };
}

function premiumDetection(premium: number, confidence: "high" | "medium"): Detection {
  const stated = `${formatNumber(premium)}%`;
  if (premium < 50) {
    return problem(
      "likely_void",
      "high",
      `This clause pays overtime with a premium of ${stated}, below the legal minimum: ${LEGAL_RATE}.`,
      confidence,
    );
  }
  if (premium === 50) {
    return passes(
      "compliant",
      `This clause pays overtime at the legal rate: ${LEGAL_RATE}.`,
      confidence,
    );
  }
  return passes(
    "better_than_law",
    `This clause pays overtime with a premium of ${stated}, more than the legal minimum of 50%.`,
    confidence,
  );
}
