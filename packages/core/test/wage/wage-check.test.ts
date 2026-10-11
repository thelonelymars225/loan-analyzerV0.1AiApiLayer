import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkWages } from "../../src/wage-check";
import { readContractsCsv, readPayrollCsv, WageFileError } from "../../src/wage-files";

/** The mock Mudad wage file and contracts from labor-rater/mock-data (all made up). */
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("checkWages on the 12 planted mock cases", () => {
  const result = checkWages({
    ...readContractsCsv(fixture("contracts-mock.csv")),
    payroll: readPayrollCsv(fixture("mudad-wage-file-mock.csv")),
  });
  const issuesOf = (id: string) =>
    result.employees.find((e) => e.employeeId === id)?.issues;

  it.each([
    ["1000000011", "everything matches", ""],
    ["2000000012", "everything matches, non-Saudi", ""],
    ["1000000013", "basic moved into allowances", "payroll_differs:basic"],
    ["2000000014", "housing missing", "payroll_differs:housing underpaid:total"],
    [
      "1000000015",
      "underpaid 1,500",
      "payroll_differs:basic payroll_differs:housing payroll_differs:transport underpaid:total",
    ],
    [
      "2000000016",
      "raise not documented",
      "payroll_differs:basic payroll_differs:housing",
    ],
    ["2000000017", "no Qiwa contract", "no_contract:null"],
    ["1000000018", "missing from payroll", "not_paid:total"],
    ["2000000019", "deductions over half (not checked)", ""],
    ["1000000020", "net is wrong (not checked)", ""],
    ["2000000021", "one-off overtime is ignored", ""],
    ["1000000022", "offer promise not in Qiwa", "offer_differs:total"],
  ])("%s: %s", (id, _case, expected) => {
    expect(
      issuesOf(id)
        ?.map((i) => `${i.kind}:${i.field}`)
        .join(" "),
    ).toBe(expected);
  });

  it("counts and lists flagged employees first", () => {
    expect(result.summary).toEqual({ employees: 12, flagged: 7 });
    expect(result.employees.slice(0, 7).every((e) => e.issues.length > 0)).toBe(true);
    expect(issuesOf("1000000015")?.at(-1)).toMatchObject({
      gap: -1500,
      articles: ["61"],
    });
  });
});

it("names missing wage file columns", () => {
  expect(() => readPayrollCsv("\uFEFFEmployeeID,BasicSalary\r\n1,2")).toThrow(
    new WageFileError(
      "Missing columns: EmployeeName, HousingAllowance, OtherAllowances.",
    ),
  );
});
