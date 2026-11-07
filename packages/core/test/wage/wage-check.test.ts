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
      "Missing columns: EmployeeName (اسم الموظف), HousingAllowance (بدل السكن), " +
        "OtherAllowances (البدلات الأخرى).",
    ),
  );
});

it("reads Arabic or loosely written column names, a title row and Arabic digits", () => {
  const csv = [
    "كشف رواتب سبتمبر 2026,,,,",
    "رقم الإقامة,اسم الموظف,الراتب الاساسي,بدل السكن,بدلات أخرى",
    '٢٠٠٠٠٠٠٠١٢,Ravi Sample,"٦٬٠٠٠٫٥٠",1500,500',
  ].join("\n");
  expect(readPayrollCsv(csv)).toEqual([
    {
      employeeId: "2000000012",
      name: "Ravi Sample",
      basic: 6000.5,
      housing: 1500,
      transport: 500,
      total: 8000.5,
    },
  ]);

  const english =
    "Employee ID,employee_name,Basic Salary,HOUSING ALLOWANCE,Other Allowances\n1,A,1,1,1";
  expect(readPayrollCsv(english)[0]?.employeeId).toBe("1");
});

it("flags a person listed twice instead of comparing one of the rows", () => {
  const row = { employeeId: "1000000011", name: null, housing: 0, transport: 0 };
  const qiwa = [{ ...row, basic: 9000, total: 9000 }];
  // Paid twice, or one row is wrong: either way, not "underpaid 4,000".
  const payroll = [
    { ...row, basic: 9000, total: 9000 },
    { ...row, basic: 5000, total: 5000 },
  ];
  const [employee] = checkWages({ qiwa, offers: [], payroll }).employees;
  expect(employee?.issues.map((i) => i.kind)).toEqual(["duplicate"]);
  expect(employee?.issues[0]?.message).toBe(
    "Listed more than once in payroll. Check which row is right.",
  );
});

it("flags an offer whose ID matches no Qiwa contract instead of dropping it", () => {
  const row = { name: null, basic: 9000, housing: 2250, transport: 900, total: 12150 };
  const qiwa = [{ ...row, employeeId: "1000000101" }];
  // The ATS typed the candidate's ID wrong, or the contract was drafted for someone else.
  const offers = [{ ...row, employeeId: "1000000110" }];
  const { summary, employees } = checkWages({ qiwa, offers });
  expect(summary).toEqual({ employees: 2, flagged: 1 });
  expect(employees[0]).toMatchObject({
    employeeId: "1000000110",
    issues: [
      { kind: "no_contract", message: expect.stringMatching(/^Has an offer letter/) },
    ],
  });
});

it("names the row that has no ID, such as a totals row", () => {
  const csv =
    "EmployeeID,EmployeeName,BasicSalary,HousingAllowance,OtherAllowances\nTOTAL,,90000,22500,9000";
  expect(() => readPayrollCsv(csv)).toThrow(
    new WageFileError("A row has no EmployeeID: TOTAL,,90000,22500,9000"),
  );
});
