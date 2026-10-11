import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Problem, WageCheckResponse } from "@rater/contracts";
import {
  api,
  DATABASE_URL,
  createTestContext,
  fixture,
  multipart,
  signUp,
  type TestContext,
} from "./helpers";

describe.skipIf(!DATABASE_URL)("POST /wage-checks", () => {
  let t: TestContext;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestContext();
    cookie = (await signUp(t.app)).cookie;
  });
  afterAll(async () => {
    await t?.close();
  });

  async function post(
    cookie: string,
    files: Record<string, Buffer | string>,
    fields: Record<string, string> = {},
  ) {
    const parts = Object.entries(files).map(([field, c]) => ({
      field,
      content: Buffer.from(c),
    }));
    const body = await multipart(fields, ...parts);
    return api(t.app, cookie, "POST", "/wage-checks", body.payload, body.headers);
  }

  it("checks the mock contracts CSV against the mock wage file", async () => {
    const response = await post(cookie, {
      payroll: await fixture("mudad-wage-file-mock.csv"),
      contracts: await fixture("contracts-mock.csv"),
    });
    expect(response.statusCode).toBe(200);
    expect(WageCheckResponse.parse(response.json()).summary).toEqual({
      employees: 12,
      flagged: 7,
    });
  });

  it("reads the wage and ID from a Qiwa PDF and compares the typed offer letter", async () => {
    // The synthetic contract: ID 1000000031, wage 9,000 + 2,250 + 900 + 500 other = 13,000.
    const payroll =
      "EmployeeID,EmployeeName,BasicSalary,HousingAllowance,OtherAllowances\n" +
      "1000000031,Test,8000,2250,1400\n";
    const response = await post(
      cookie,
      { payroll, contract: await fixture("wage-mismatch.pdf") },
      { offerTotal: "13,500" },
    );
    expect(response.statusCode).toBe(200);
    const [employee] = WageCheckResponse.parse(response.json()).employees;
    expect(employee?.issues.map((i) => [i.kind, i.field, i.gap])).toEqual([
      ["payroll_differs", "basic", -1000],
      ["underpaid", "total", -1350],
      ["offer_differs", "total", 500],
    ]);
  });

  it("answers 400 with the problem for a bad file, and 401 without a session", async () => {
    const bad = await post(cookie, { payroll: "EmployeeID\n1", contracts: "x" });
    expect(bad.statusCode).toBe(400);
    expect(Problem.parse(bad.json()).detail).toMatch(/^Missing columns: EmployeeName/);

    const anonymous = await post("", { payroll: "x", contracts: "x" });
    expect(anonymous.statusCode).toBe(401);
  });
});
