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
  const kinds = Object.fromEntries(
    result.employees.map((e) => [
      e.employeeId,
      e.issues.map((i) => `${i.kind}:${i.field}`),
    ]),
  );

  it.each([
    ["1000000011", "everything matches", []],
    ["2000000012", "everything matches, non-Saudi", []],
    ["1000000013", "basic moved into allowances", ["payroll_differs:basic"]],
    ["2000000014", "housing missing", ["payroll_differs:housing", "underpaid:total"]],
    [
      "1000000015",
      "underpaid 1,500",
      [
        "payroll_differs:basic",
        "payroll_differs:housing",
        "payroll_differs:transport",
        "underpaid:total",
      ],
    ],
    [
      "2000000016",
      "raise not documented",
      ["payroll_differs:basic", "payroll_differs:housing"],
    ],
    ["2000000017", "no Qiwa contract", ["no_contract:null"]],
    ["1000000018", "missing from payroll", ["not_paid:total"]],
    ["2000000019", "deductions over half", ["deductions_over_half:deductions"]],
    ["1000000020", "net is wrong", ["net_mismatch:net"]],
    ["2000000021", "one-off overtime is ignored", []],
    ["1000000022", "offer promise not in Qiwa", ["offer_differs:total"]],
  ])("%s: %s", (id, _case, expected) => {
    expect(kinds[id]).toEqual(expected);
  });

  it("sums the shortfalls and lists flagged employees first", () => {
    expect(result.summary).toEqual({ employees: 12, flagged: 9, underpaidSar: 3250 });
    expect(result.employees.slice(0, 9).every((e) => e.issues.length > 0)).toBe(true);
    const sara = result.employees.find((e) => e.employeeId === "1000000015");
    expect(sara?.issues.at(-1)).toMatchObject({ gap: -1500, articles: ["61"] });
  });
});

describe("wage files", () => {
  it("names missing columns", () => {
    expect(() => readPayrollCsv("EmployeeID,BasicSalary\n1,2")).toThrow(
      new WageFileError(
        "Missing column(s): EmployeeName, HousingAllowance, OtherAllowances, Deductions, NetSalary.",
      ),
    );
  });

  it("reads quoted cells and thousands separators", () => {
    const csv =
      'EmployeeID,EmployeeName,Source,BasicSalary,HousingAllowance,TransportAllowance,TotalWage\r\n1000000011,"Al-Mock, Ahmed",qiwa,"11,111",2778,1111,"15,000"\r\n';
    expect(readContractsCsv(csv).qiwa).toEqual([
      {
        employeeId: "1000000011",
        name: "Al-Mock, Ahmed",
        basic: 11111,
        housing: 2778,
        transport: 1111,
        total: 15000,
      },
    ]);
  });
});
