import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CaseSpec } from "./case-spec";
import { Expected } from "./expected";
import { OtherDocumentSpec } from "./other-document";

/*
 * Eval cases on disk: evals/cases/<id>/{case.json, contract.pdf, expected.json}. Private cases
 * (real contracts, outside git) only need contract.pdf and expected.json.
 */

export const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));

export interface EvalCase {
  id: string;
  pdfPath: string;
  expected: Expected;
  /** A real contract from --private: its field values and dates are never printed or saved. */
  isPrivate: boolean;
}

/** What case.json describes: a Qiwa contract, or a document the pipeline must reject. */
export type CaseFile =
  { kind: "qiwa"; spec: CaseSpec } | { kind: "other_document"; spec: OtherDocumentSpec };

/** Every case in `dir`, one sub-directory each, in name order. */
export function loadCases(dir: string, options: { isPrivate: boolean }): EvalCase[] {
  return caseDirs(dir).map((caseDir) => {
    const id = caseDir.split("/").pop() ?? caseDir;
    const pdfPath = join(caseDir, "contract.pdf");
    const expectedPath = join(caseDir, "expected.json");
    for (const path of [pdfPath, expectedPath]) {
      if (!existsSync(path)) throw new Error(`${path} is missing`);
    }
    const expected = readExpected(expectedPath);
    if (expected.id !== id) {
      throw new Error(
        `${expectedPath}: id "${expected.id}" does not match the folder name`,
      );
    }
    return { id, pdfPath, expected, isPrivate: options.isPrivate };
  });
}

/** Sub-directories of `dir` (full paths), sorted by name. */
export function caseDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(dir, name));
}

export function readExpected(path: string): Expected {
  const result = Expected.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!result.success) {
    throw new Error(`${path}: ${result.error.message}`);
  }
  return result.data;
}

export function readCaseFile(path: string): CaseFile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const isOther =
    typeof raw === "object" &&
    raw !== null &&
    (raw as { kind?: unknown }).kind === "other_document";
  return isOther
    ? { kind: "other_document", spec: OtherDocumentSpec.parse(raw) }
    : { kind: "qiwa", spec: CaseSpec.parse(raw) };
}
