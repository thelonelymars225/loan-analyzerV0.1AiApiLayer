import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Problem, WageCheckResponse } from "@rater/contracts";
import {
  DATABASE_URL,
  createTestContext,
  fixture,
  ORIGIN,
  signUp,
  type TestContext,
} from "./helpers";

/** The synthetic wage-mismatch contract: ID 1000000031, wage 9,000 + 2,250 + 900 + 500 other, total 13,000. */
const PAYROLL_HEADER =
  "EmployeeID,EmployeeName,BasicSalary,HousingAllowance,OtherAllowances,Deductions,NetSalary";

async function post(
  t: TestContext,
  cookie: string,
  files: Record<string, Buffer | string>,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const [name, content] of Object.entries(files)) {
    form.append(
      name,
      new Blob([typeof content === "string" ? content : new Uint8Array(content)]),
      name,
    );
  }
  const request = new Request("http://localhost/", { method: "POST", body: form });
  return t.app.inject({
    method: "POST",
    url: "/api/v1/wage-checks",
    headers: {
      "content-type": request.headers.get("content-type") ?? "",
      cookie,
      origin: ORIGIN,
    },
    payload: Buffer.from(await request.arrayBuffer()),
  });
}

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

  it("checks the mock contracts CSV against the mock wage file", async () => {
    const mock = (name: string) =>
      readFile(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url));
    const response = await post(t, cookie, {
      payroll: await mock("mudad-wage-file-mock.csv"),
      contracts: await mock("contracts-mock.csv"),
    });
    expect(response.statusCode).toBe(200);
    expect(WageCheckResponse.parse(response.json()).summary).toEqual({
      employees: 12,
      flagged: 9,
      underpaidSar: 3250,
    });
  });

  it("reads the wage and ID from a Qiwa PDF and compares the typed offer letter", async () => {
    const payroll = `${PAYROLL_HEADER}\n1000000031,Test,8000,2250,1400,0,11650\n`;
    const response = await post(
      t,
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
    const bad = await post(t, cookie, { payroll: "EmployeeID\n1", contracts: "x" });
    expect(bad.statusCode).toBe(400);
    expect(Problem.parse(bad.json()).detail).toMatch(
      /^Missing column\(s\): EmployeeName/,
    );

    const anonymous = await post(t, "", { payroll: "x", contracts: "x" });
    expect(anonymous.statusCode).toBe(401);
  });
});
