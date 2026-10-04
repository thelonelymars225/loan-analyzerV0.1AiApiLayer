import { describe, expect, it } from "vitest";
import { normaliseText, tokenize } from "../src";

const RLM = "\u200F"; // right-to-left mark
const LRE = "\u202A"; // left-to-right embedding
const PDF = "\u202C"; // pop directional formatting
const TATWEEL = "\u0640";
const FATHA = "\u064E";
const SHADDA = "\u0651";

describe("normaliseText", () => {
  it("strips tashkeel, tatweel and bidi controls", () => {
    const decorated = `${RLM}الإجا${TATWEEL}زة${FATHA} السن${SHADDA}وية${LRE}${PDF}`;
    expect(normaliseText(decorated)).toBe(normaliseText("الإجازة السنوية"));
  });

  it("unifies alef, yaa and taa marbuta", () => {
    expect(normaliseText("أإآا")).toBe("اااا");
    expect(normaliseText("على")).toBe("علي");
    expect(normaliseText("مكافأة")).toBe("مكافاه");
  });

  it("turns Arabic-Indic digits into ASCII and folds compatibility forms", () => {
    expect(normaliseText("٢٧٠ يوماً")).toBe("270 يوما");
    expect(normaliseText("۱۸۰")).toBe("180");
    expect(normaliseText("ﻻ")).toBe("لا"); // presentation-form ligature
  });

  it("lower-cases English", () => {
    expect(normaliseText("End-Of-Service")).toBe("end-of-service");
  });
});

describe("tokenize", () => {
  it("drops stopwords and punctuation, keeps numbers", () => {
    expect(tokenize("The probation shall not exceed 180 days.")).toEqual([
      "probation",
      "exceed",
      "180",
      "day",
    ]);
  });

  it("strips the Arabic definite article and its prefixed forms", () => {
    expect(tokenize("الإجازة وللعامل بالأجر")).toEqual(["اجازه", "عامل", "اجر"]);
  });

  it("folds English plurals", () => {
    expect(tokenize("years parties hours business")).toEqual([
      "year",
      "party",
      "hour",
      "business",
    ]);
  });
});
