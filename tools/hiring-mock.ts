/*
 * Scenario 2 mock: ten new hires at a fake company, as an ATS holds them before the Qiwa
 * contract goes to the employee. Each has the drafted Qiwa contract as a PDF and the accepted
 * offer as data, with some mismatches planted. Writes the PDFs and hires.json (offers and the
 * expected issues) to apps/api/test/fixtures/hiring/. Everything is made up.
 *
 *   CHROME_PATH=/usr/bin/google-chrome pnpm exec tsx tools/hiring-mock.ts
 *
 * The PDFs are printed by headless Chrome, which needs an Arabic font for the Arabic column.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Pay {
  basic: number;
  housing: number;
  transport: number;
}
type Offer = Partial<Pay & { total: number }>;

const pay = (basic: number, housing: number, transport: number): Pay => ({
  basic,
  housing,
  transport,
});
const all = (p: Pay): Offer => ({ ...p, total: p.basic + p.housing + p.transport });

/** [ID, name, Qiwa contract, accepted offer, expected issues as kind:field]. */
const HIRES: [string, string, Pay, Offer, string[]][] = [
  ["1000000101", "Abdulrahman Mock", pay(9000, 2250, 900), all(pay(9000, 2250, 900)), []],
  ["2000000102", "Arjun Sample", pay(4000, 1000, 400), { total: 5400 }, []],
  [
    "1000000103",
    "Haya Example",
    pay(12000, 2250, 1200),
    all(pay(12000, 3000, 1200)),
    ["offer_differs:housing", "offer_differs:total"],
  ],
  [
    "2000000104",
    "Mark Fixture",
    pay(6000, 1500, 0),
    all(pay(6000, 1500, 600)),
    ["offer_differs:transport", "offer_differs:total"],
  ],
  [
    "1000000105",
    "Nawaf Test",
    pay(8000, 3000, 800),
    all(pay(9000, 2000, 800)),
    ["offer_differs:basic", "offer_differs:housing"],
  ],
  [
    "1000000106",
    "Shahad Demo",
    pay(10000, 2500, 1000),
    { total: 14500 },
    ["offer_differs:total"],
  ],
  [
    "2000000107",
    "Liza Placeholder",
    pay(5000, 1250, 500),
    all(pay(4500, 1250, 500)),
    ["offer_differs:basic", "offer_differs:total"],
  ],
  ["1000000108", "Ghada Stub", pay(15000, 3750, 1500), { basic: 15000 }, []],
  ["2000000109", "Tariq Dummy", pay(3500, 875, 350), all(pay(3500, 875, 350)), []],
  [
    "1000000110",
    "Majed Specimen",
    pay(11111, 2778, 1111),
    { housing: 2778, total: 16000 },
    ["offer_differs:total"],
  ],
];

const OUT = new URL("../apps/api/test/fixtures/hiring/", import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH ?? "chromium";
const sar = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

/** HTML → PDF bytes, printed by headless Chrome. */
function pdf(html: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "hiring-"));
  try {
    writeFileSync(join(dir, "page.html"), `<!doctype html><meta charset="utf-8">${html}`);
    execFileSync(
      CHROME,
      ["--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer"].concat(
        "--print-to-pdf=out.pdf",
        "page.html",
      ),
      { cwd: dir, stdio: "ignore" },
    );
    return readFileSync(join(dir, "out.pdf"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One bilingual row: English label, value, Arabic value, Arabic label. */
const row = (en: string, value: string, ar: string, valueAr = "") =>
  `<tr><td>${en}</td><td>${value}</td><td class="ar">${valueAr}</td><td class="ar">${ar}</td></tr>`;
const section = (en: string, ar: string, body = "") =>
  `<h2><span>${en}</span><span class="ar">${ar}</span></h2>${body}`;
const para = (en: string, ar: string) =>
  `<table><tr><td>${en}</td><td class="ar">${ar}</td></tr></table>`;

/** A Qiwa "Unified Employment Contract" with the sections the extractor reads. */
function qiwaContract(id: string, name: string, p: Pay): string {
  const wage = (en: string, ar: string, n: number) =>
    row(en, `${sar(n)} Monthly`, ar, `${sar(n)} شهري`);
  return `<style>
    body { font: 12px sans-serif; margin: 32px }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px }
    td { padding: 5px 4px; vertical-align: top }
    .ar { direction: rtl; text-align: right }
    h2 { font-size: 13px; display: flex; justify-content: space-between }
  </style>
  <h1 style="text-align:center;font-size:16px">عقد العمل الموحد<br>Unified Employment Contract</h1>
  ${section(
    "1. Contract Information",
    "1. بيانات العقد",
    `<table>${row("Contract number:", `5${id.slice(1)}`, "رقم العقد :")}${row(
      "Contract type:",
      "Fixed-term Contract",
      "نوع العقد من حيث مدته :",
      "عقد محدد المدة",
    )}${row("Commencement date:", "2026/12/01", "تاريخ مباشرة العمل :")}</table>`,
  )}
  ${section(
    "2. First Party’s Information",
    "2. بيانات الطرف الأول",
    `<table>${row("Establishment Name (Employer):", "Example Trading Co.", "اسم المنشأة (صاحب العمل) :")}</table>`,
  )}
  ${section(
    "3. Second Party’s Information",
    "3. بيانات الطرف الثاني",
    `<table>${row("Employee name:", name, "اسم العامل :")}${row("ID no.:", id, "رقم الهوية :")}</table>`,
  )}
  ${section("5. Contract Period", "5. مدة العقد")}
  ${para("5.1 This contract is valid for a period of 1 year, starting from the commencement date mentioned in Clause No. (1).", "5.1 مدة هذا العقد سنة.")}
  ${section("6. Probationary Period", "6. فترة التجربة")}
  ${para("6.1 The Second Party is subject to a specified probationary period of 90 days, starting from the commencement date of work.", "6.1 فترة تجربة مدتها 90 يومًا.")}
  ${section(
    "9. Wage & Benefits",
    "9. الأجر والمزايا",
    `<table>${wage("9.1.1.1 Basic Wage:", "9.1.1.1 الأجر الأساسي :", p.basic)}${wage(
      "9.1.1.2 Housing Allowance:",
      "9.1.1.2 بدل السكن :",
      p.housing,
    )}${wage("9.1.1.3 Transportation Allowance:", "9.1.1.3 بدل النقل :", p.transport)}${wage(
      "9.1.1.5 Total Wage:",
      "9.1.1.5 إجمالي الأجر :",
      p.basic + p.housing + p.transport,
    )}</table>`,
  )}
  <p style="text-align:center;color:#888">SYNTHETIC TEST CONTRACT - NOT A REAL DOCUMENT</p>`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const hires = HIRES.map(([id, name, contract, offer, expected]) => {
  writeFileSync(join(OUT, `${id}.pdf`), pdf(qiwaContract(id, name, contract)));
  return { id, name, contract: `${id}.pdf`, offer, expected };
});
writeFileSync(join(OUT, "hires.json"), JSON.stringify(hires, null, 2) + "\n");
console.log(`Wrote ${hires.length} hires to ${OUT}`);
