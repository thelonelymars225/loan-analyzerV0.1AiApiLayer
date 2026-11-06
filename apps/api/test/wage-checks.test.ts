import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Problem, WageCheckResponse, WageRecord } from "@rater/contracts";
import { readContractsCsv, readPayrollCsv } from "@rater/core";
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

  it("takes the same records as JSON, as an HRIS would send them", async () => {
    const { qiwa, offers } = readContractsCsv(
      String(await fixture("contracts-mock.csv")),
    );
    // An HRIS sends the parts it pays, not a total: the check adds them up.
    const payroll = readPayrollCsv(String(await fixture("mudad-wage-file-mock.csv"))).map(
      (row) => ({ ...row, total: null }),
    );
    const ok = await api(t.app, cookie, "POST", "/wage-checks/records", {
      qiwa,
      offers,
      payroll,
    });
    expect(ok.statusCode).toBe(200);
    expect(WageCheckResponse.parse(ok.json()).summary).toEqual({
      employees: 12,
      flagged: 7,
    });

    // An ERP's nightly job: amounts left out, or sent as SAP OData decimal strings.
    const erp = await api(t.app, cookie, "POST", "/wage-checks/records", {
      qiwa: [{ employeeId: "1000000011", basic: "9000.00", housing: "2250.00" }],
      payroll: [{ employeeId: "1000000011", basic: "8000.00", housing: 2250 }],
    });
    const [employee] = WageCheckResponse.parse(erp.json()).employees;
    expect(employee?.issues.map((i) => [i.kind, i.field, i.gap])).toEqual([
      ["payroll_differs", "basic", -1000],
    ]);

    const bad = await api(t.app, cookie, "POST", "/wage-checks/records", { payroll });
    expect(bad.statusCode).toBe(400);

    // Above Fastify's default 1 MB body limit, and without names.
    const people = Array.from({ length: 10_000 }, (_, i) => ({
      employeeId: String(1_000_000_000 + i),
      basic: 8000,
      housing: 2000,
      transport: 800,
      total: 10800,
    }));
    const big = await api(t.app, cookie, "POST", "/wage-checks/records", {
      qiwa: people,
      payroll: people,
    });
    expect(big.statusCode).toBe(200);
    expect(WageCheckResponse.parse(big.json()).summary.flagged).toBe(0);
  });

  it("checks a new hire's offer against Qiwa before there is any payroll", async () => {
    const pdf = await post(
      cookie,
      { contract: await fixture("wage-mismatch.pdf") },
      { offerTotal: "13,500" },
    );
    const json = await api(t.app, cookie, "POST", "/wage-checks/records", {
      qiwa: [
        {
          employeeId: "1000000031",
          basic: 9000,
          housing: 2250,
          transport: 1400,
          total: 13000,
        },
      ],
      offers: [
        {
          employeeId: "1000000031",
          basic: 9000,
          housing: 3000,
          transport: 1400,
          total: 13750,
        },
      ],
    });
    const kinds = (r: typeof pdf) =>
      WageCheckResponse.parse(r.json()).employees[0]?.issues.map((i) => [
        i.kind,
        i.field,
      ]);
    // No "not paid": nobody is paid yet.
    expect(kinds(pdf)).toEqual([["offer_differs", "total"]]);
    expect(kinds(json)).toEqual([
      ["offer_differs", "housing"],
      ["offer_differs", "total"],
    ]);
  });

  it("checks the ten mock new hires the way an ATS would, one Qiwa PDF each", async () => {
    // Made by tools/hiring-mock.ts: a drafted Qiwa PDF and the accepted offer per hire.
    const hires = JSON.parse(String(await fixture("hires.json"))) as {
      id: string;
      contract: string;
      offer: Record<string, number>;
      expected: string[];
    }[];
    const field = (part: string) => `offer${part[0]?.toUpperCase()}${part.slice(1)}`;
    for (const hire of hires) {
      const offer = Object.entries(hire.offer).map(([part, n]) => [
        field(part),
        String(n),
      ]);
      const contract = await fixture(hire.contract);
      const response = await post(cookie, { contract }, Object.fromEntries(offer));
      const [employee] = WageCheckResponse.parse(response.json()).employees;
      expect(employee?.employeeId).toBe(hire.id);
      expect(employee?.issues.map((i) => `${i.kind}:${i.field}`)).toEqual(hire.expected);
    }
  });

  it("audits a manpower agency's month: 2,000 workers in Excel-style exports", async () => {
    const SITES = [
      "Riyadh Hospital",
      "Jeddah Port",
      "NEOM Camp",
      "Dammam Mall",
      "Qassim Farm",
    ];
    const workers = Array.from({ length: 2000 }, (_, i) => ({
      id: String((i % 4 ? 2 : 1) * 1e9 + 100_000 + i),
      name: `"Worker, No. ${i}"`, // Excel quotes a cell holding a comma
      basic: 2000 + ((i * 37) % 6000),
      site: SITES[i % 5],
    }));
    // Amounts as Excel writes them with a number format: "6,500".
    const pay = (basic: number) =>
      [basic, basic / 4, basic / 10].map((n) => `"${n.toLocaleString("en-US")}"`);
    const contracts = [
      "EmployeeID,EmployeeName,Nationality,Source,BasicSalary,HousingAllowance,TransportAllowance,TotalWage,ClientSite",
      ...workers.map((w) => [w.id, w.name, "SA", "qiwa", ...pay(w.basic), "", w.site]),
    ];
    // Planted: every 100th worker is paid 100 SAR less basic, and the last 5 are not paid.
    const payroll = [
      "EmployeeID,EmployeeName,IBAN,BasicSalary,HousingAllowance,OtherAllowances,ClientSite",
      ...workers.slice(0, -5).map((w, i) => {
        const [basic, ...rest] = pay(w.basic);
        const paid = i % 100 ? basic : `${w.basic - 100}`;
        return [w.id, w.name, "SA00", paid, ...rest, w.site];
      }),
      ",,,,,,", // the empty row Excel leaves at the end
    ];
    const csv = (rows: unknown[]) => "\uFEFF" + rows.map(String).join("\r\n");
    const response = await post(cookie, {
      contracts: csv(contracts),
      payroll: csv(payroll),
    });
    expect(response.statusCode).toBe(200);
    expect(WageCheckResponse.parse(response.json()).summary).toEqual({
      employees: 2000,
      flagged: 25,
    });
  });

  it("lets an auditor read many Qiwa PDFs one by one, then check them together", async () => {
    // The ten mock hires stand in for a company's contract folder.
    const hires = JSON.parse(String(await fixture("hires.json"))) as {
      contract: string;
    }[];
    const qiwa = [];
    for (const { contract } of hires) {
      const body = await multipart(
        {},
        { field: "contract", content: await fixture(contract) },
      );
      const read = await api(
        t.app,
        cookie,
        "POST",
        "/wage-checks/contract",
        body.payload,
        body.headers,
      );
      qiwa.push(WageRecord.parse(read.json()));
    }
    // Payroll as found: the first is paid 500 less basic, the last isn't paid.
    const payroll = qiwa
      .slice(0, -1)
      .map((r, i) => ({
        ...r,
        basic: (r.basic ?? 0) - (i === 0 ? 500 : 0),
        total: null,
      }));
    const check = await api(t.app, cookie, "POST", "/wage-checks/records", {
      qiwa,
      payroll,
    });
    const { summary, employees } = WageCheckResponse.parse(check.json());
    expect(summary).toEqual({ employees: 10, flagged: 2 });
    expect(employees.slice(0, 2).map((e) => e.issues.map((i) => i.kind))).toEqual([
      ["payroll_differs", "underpaid"],
      ["not_paid"],
    ]);
  });

  it("explains two PDFs in one check and Excel files instead of misreading them", async () => {
    const pdf = await fixture("wage-mismatch.pdf");
    const two = await multipart(
      {},
      { field: "contract", content: pdf },
      { field: "contract", content: pdf },
    );
    const twice = await api(
      t.app,
      cookie,
      "POST",
      "/wage-checks",
      two.payload,
      two.headers,
    );
    expect(Problem.parse(twice.json()).detail).toMatch(/^Send one file in "contract"/);

    const xlsx = await post(cookie, {
      contract: pdf,
      payroll: "PK\u0003\u0004 workbook",
    });
    expect(Problem.parse(xlsx.json()).detail).toBe(
      "Excel files aren't read yet. Save the sheet as CSV (UTF-8).",
    );
  });

  it("answers 400 with the problem for a bad file, and 401 without a session", async () => {
    const bad = await post(cookie, { payroll: "EmployeeID\n1", contracts: "x" });
    expect(bad.statusCode).toBe(400);
    expect(Problem.parse(bad.json()).detail).toMatch(/^Missing columns: EmployeeName/);

    const anonymous = await post("", { payroll: "x", contracts: "x" });
    expect(anonymous.statusCode).toBe(401);
  });
});
