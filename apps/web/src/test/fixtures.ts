import type {
  MeResponse,
  Passage,
  RatingReport,
  View,
  ViewDeadline,
  ViewFinding,
} from "@rater/contracts";

/**
 * One synthetic rating rendered in both views, the way the API does it: same findings, the
 * view picks the message, the action and the order. No real contract data anywhere.
 */

interface BaseFinding extends Omit<ViewFinding, "message" | "action"> {
  employeeMsg: string;
  hrMsg: string;
  askFor: string | null;
  suggestedWording: string | null;
}

const base = (
  overrides: Partial<BaseFinding> & Pick<BaseFinding, "ruleId" | "title">,
): BaseFinding => ({
  clause: null,
  verdict: "unclear",
  severity: "low",
  confidence: "high",
  categories: ["legal"],
  explanation: "Synthetic explanation.",
  articles: [],
  impactSar: null,
  impactKind: null,
  needsReview: false,
  passages: [],
  employeeMsg: "",
  hrMsg: "",
  askFor: null,
  suggestedWording: null,
  ...overrides,
});

/** Where a clause sits on the synthetic contract's A4 pages; the API cuts `crop` as the image. */
export function syntheticPassage(
  clause: string,
  page: number,
  yMin: number,
  overrides: Partial<Passage> = {},
): Passage {
  const pageWidth = 595.92;
  const pageHeight = 842.04;
  const yMax = yMin + 40;
  return {
    clause,
    page,
    pageWidth,
    pageHeight,
    box: { xMin: 45.4, yMin, xMax: 574.2, yMax },
    crop: { xMin: 0, yMin: yMin - 18, xMax: pageWidth, yMax: yMax + 18 },
    textEn: null,
    textAr: null,
    approximate: false,
    ...overrides,
  };
}

const PROBLEMS = {
  eos: base({
    ruleId: "EOS-BASE-01",
    title: "End-of-service on basic wage only",
    clause: "15.6",
    verdict: "likely_void",
    severity: "high",
    articles: ["Art. 2", "Art. 84", "Art. 8"],
    impactKind: "eos_gap",
    impactSar: { "1y": 1750, "5y": 8750, "10y": 26250 },
    passages: [
      syntheticPassage("15.6", 8, 600, {
        textEn: "The end-of-service award is calculated on the basic wage.",
        textAr: "تُحتسب مكافأة نهاية الخدمة على الأجر الأساسي.",
      }),
    ],
    employeeMsg:
      "Likely void: end-of-service is calculated on your full actual wage, not basic only.",
    hrMsg: "Likely void and unenforceable. Base the award on the last actual wage.",
    askFor: "Ask for the award to be based on your total wage.",
    suggestedWording: "The end-of-service award is calculated on the last actual wage.",
  }),
  typeConflict: base({
    ruleId: "TYPE-CONFLICT-01",
    title: "Contract type contradicts Section 1",
    clause: "15.1",
    verdict: "conflict",
    severity: "high",
    categories: ["legal", "clarity"],
    articles: ["Art. 55"],
    // A conflict points at its clause and at the template clause it contradicts.
    passages: [syntheticPassage("15.1", 8, 400), syntheticPassage("1", 1, 120)],
    employeeMsg:
      "Section 15 calls this contract unlimited, but Section 1 says fixed-term.",
    hrMsg: "Clause 15.1 contradicts the contract type in Section 1. Align them.",
    askFor: "Ask which contract type applies, in writing.",
    suggestedWording: "Delete clause 15.1.",
  }),
  compensation: base({
    ruleId: "COMP-ART77-01",
    title: "Early-termination compensation below the default",
    clause: "15.4",
    verdict: "worse_than_default",
    severity: "high",
    categories: ["market"],
    articles: ["Art. 77"],
    impactKind: "art77_gap",
    impactSar: { contract: 20000, default: 150000, gap: 130000 },
    passages: [syntheticPassage("15.4", 8, 520)],
    employeeMsg:
      "If the employer ends the contract early you get two months' basic wage instead of the rest of the term.",
    hrMsg: "Legal, but well below the Art. 77 default. Expect pushback from candidates.",
    askFor: "Ask for compensation equal to the remaining term.",
    suggestedWording: "Compensation follows Article 77 of the Labor Law.",
  }),
  transfer: base({
    ruleId: "TRANSFER-KSA-01",
    title: "Transfer anywhere in the Kingdom",
    clause: "15.3",
    verdict: "worse_than_default",
    severity: "medium",
    categories: ["market"],
    articles: ["Exec. Reg. Art. 20"],
    passages: [syntheticPassage("15.3", 8, 480)],
    employeeMsg: "You pre-agree to relocate anywhere in the Kingdom.",
    hrMsg: "Enforceable. Keep it only if you need mobility.",
    askFor: "Ask for a city limit.",
  }),
  review: base({
    ruleId: "REVIEW-00",
    title: "Clause needs review",
    clause: "15.8",
    confidence: "low",
    needsReview: true,
    // The clause itself was not located, so the whole section is shown.
    passages: [syntheticPassage("15", 8, 360, { approximate: true })],
    employeeMsg: "We could not analyse this clause reliably.",
    hrMsg: "Automatic analysis failed for this clause.",
  }),
};

/** The orders the API produces (Build Plan): employee by SAR impact, HR by severity then legal risk. */
const ORDER: Record<View, (keyof typeof PROBLEMS)[]> = {
  employee: ["compensation", "eos", "typeConflict", "transfer", "review"],
  hr: ["eos", "typeConflict", "compensation", "transfer", "review"],
};

function toViewFinding(finding: BaseFinding, view: View): ViewFinding {
  const { employeeMsg, hrMsg, askFor, suggestedWording, ...rest } = finding;
  return {
    ...rest,
    message: view === "employee" ? employeeMsg : hrMsg,
    action: view === "employee" ? askFor : suggestedWording,
  };
}

const GOOD = base({
  ruleId: "LEAVE-MIN-01",
  title: "Annual leave above the minimum",
  clause: "8.1",
  verdict: "better_than_law",
  severity: "none",
  employeeMsg: "You get 22 days of annual leave, more than the 21-day minimum.",
  hrMsg: "Leave exceeds the statutory minimum.",
});

const INFO = base({
  ruleId: "SETTLE-TIME-01",
  title: "Final settlement deadline",
  verdict: "compliant",
  severity: "none",
  articles: ["Art. 88"],
  employeeMsg: "Your final dues must be paid within one week of the contract ending.",
  hrMsg: "Pay final dues within one week of the end of the contract.",
});

const DEADLINE: Omit<ViewDeadline, "message"> & { employeeMsg: string; hrMsg: string } = {
  ruleId: "RENEW-DEADLINE-01",
  kind: "renewal_notice",
  date: "2027-01-31",
  employeeMsg: "To stop auto-renewal, give notice on Qiwa by 31 Jan 2027.",
  hrMsg: "Non-renewal notice is due by 31 Jan 2027.",
};

export function syntheticReport(view: View): RatingReport {
  const { employeeMsg, hrMsg, ...deadline } = DEADLINE;
  return {
    id: "rt_test_0001",
    status: "done",
    view,
    createdAt: "2026-10-01T09:00:00Z",
    finishedAt: "2026-10-01T09:01:10Z",
    error: null,
    reviewReasons: [],
    score:
      view === "employee"
        ? {
            overall: 64,
            legal: 52,
            market: 81,
            clarity: 64,
            band: "Fair",
            marketConfidence: "low",
          }
        : {
            overall: 58,
            legal: 52,
            market: 81,
            clarity: 64,
            band: "Weak",
            marketConfidence: "low",
          },
    deadlines: [{ ...deadline, message: view === "employee" ? employeeMsg : hrMsg }],
    findings: ORDER[view].map((key) => toViewFinding(PROBLEMS[key], view)),
    good: [toViewFinding(GOOD, view)],
    info: [toViewFinding(INFO, view)],
    fields: null,
    versions: {
      law: "2025-11",
      ruleset: "0.1.0",
      prompt: "s15-v1",
      model: "heuristic-v1",
    },
    document: { pages: 10, available: true, deletedAt: null },
    disclaimer: "Rating aid, not legal advice.",
  };
}

/** A signed-in user. */
export function syntheticMe(): MeResponse {
  return {
    user: { id: "u_1", email: "nour@example.com", name: "Nour Al-Harbi" },
  };
}
