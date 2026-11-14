import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import writeExcelFile from "write-excel-file/node";
import { total, type Month, type Pay, type Person } from "./people";

/*
 * The fake documents an HR team keeps: Qiwa contracts, offer letters, wage files, emails and
 * noise. PDFs are printed by headless Chromium (CHROME_PATH), which needs an Arabic font.
 */

const CHROME = process.env.CHROME_PATH ?? "chromium";
const sar = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

/** HTML → PDF bytes. `scanned` prints a screenshot instead, so the PDF has no text layer. */
export function pdf(html: string, scanned = false): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "scenario-"));
  try {
    const page = join(dir, "page.html");
    writeFileSync(page, `<!doctype html><meta charset="utf-8">${STYLE}${html}`);
    const run = (...args: string[]) =>
      execFileSync(CHROME, ["--headless", "--no-sandbox", "--disable-gpu", ...args], {
        cwd: dir,
        stdio: "ignore",
      });
    if (scanned) {
      run("--window-size=900,1270", "--screenshot=shot.png", page);
      writeFileSync(page, `<img src="shot.png" style="width:100%">`);
    }
    run("--no-pdf-header-footer", "--print-to-pdf=out.pdf", page);
    return readFileSync(join(dir, "out.pdf"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STYLE = `<style>
  body { font: 12px "Noto Sans", "Noto Naskh Arabic", "Noto Sans Arabic", sans-serif; margin: 32px }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px }
  td { padding: 5px 4px; vertical-align: top }
  .ar { direction: rtl; text-align: right }
  h2 { font-size: 13px; display: flex; justify-content: space-between; margin: 18px 0 6px }
</style>`;

/** One bilingual row: English label, value, Arabic value, Arabic label. */
const row = (en: string, value: string, ar: string, valueAr = "") =>
  `<tr><td style="width:30%">${en}</td><td>${value}</td><td class="ar">${valueAr}</td><td class="ar" style="width:28%">${ar}</td></tr>`;
const section = (en: string, ar: string, rows: string) =>
  `<h2><span>${en}</span><span class="ar">${ar}</span></h2><table>${rows}</table>`;
const para = (en: string, ar: string) =>
  `<table><tr><td style="width:50%">${en}</td><td class="ar">${ar}</td></tr></table>`;

/** A Qiwa "Unified Employment Contract" with the sections the extractor reads. */
export function qiwaContract(p: Person): string {
  const w = p.contract!;
  const wageRow = (en: string, ar: string, n: number) =>
    row(en, `${sar(n)} Monthly`, ar, `${sar(n)} شهري`);
  return `
  <h1 style="text-align:center;font-size:16px">عقد العمل الموحد<br>Unified Employment Contract</h1>
  ${section(
    "1. Contract Information",
    "1. بيانات العقد",
    [
      row("Contract number:", p.contractNo, "رقم العقد :"),
      row(
        "Contract type:",
        "Fixed-term Contract",
        "نوع العقد من حيث مدته :",
        "عقد محدد المدة",
      ),
      row("Contract execution date:", p.start.replace(/-/g, "/"), "تاريخ إبرام العقد :"),
      row("Commencement date:", p.start.replace(/-/g, "/"), "تاريخ مباشرة العمل :"),
    ].join(""),
  )}
  ${section(
    "2. First Party’s Information",
    "2. بيانات الطرف الأول",
    [
      row(
        "Establishment Name (Employer):",
        "Example Trading Co.",
        "اسم المنشأة (صاحب العمل) :",
        "شركة المثال للتجارة",
      ),
      row("Unified national no.:", "7000000001", "الرقم الوطني الموحد :"),
    ].join(""),
  )}
  ${section(
    "3. Second Party’s Information",
    "3. بيانات الطرف الثاني",
    [
      row("Employee name:", p.name, "اسم العامل :", p.nameAr),
      row("Nationality:", p.nationality, "الجنسية :"),
      row("ID no.:", p.id, "رقم الهوية :"),
    ].join(""),
  )}
  ${section("5. Contract Period", "5. مدة العقد", "")}
  ${para("5.1 This contract is valid for a period of 1 year, starting from the commencement date mentioned in Clause No. (1).", "5.1 مدة هذا العقد سنة تبدأ من تاريخ مباشرة العمل.")}
  ${section("6. Probationary Period", "6. فترة التجربة", "")}
  ${para("6.1 The Second Party is subject to a specified probationary period of 90 days, starting from the commencement date of work.", "6.1 يخضع الطرف الثاني لفترة تجربة مدتها 90 يومًا.")}
  ${section("7. Work Hours & Weekly Rest", "7. ساعات العمل والراحة الأسبوعية", "")}
  ${para("Normal working days shall be 5 days per week and working hours shall be daily 8.", "تكون أيام العمل 5 أيام في الأسبوع وساعات العمل 8 يوميًا.")}
  ${section("8. Annual Leaves", "8. الإجازات السنوية", "")}
  ${para("8.1 The Second Party shall be entitled to a pre-paid vacation of 21 calendar days, each year.", "8.1 يستحق الطرف الثاني إجازة سنوية مدتها 21 يومًا.")}
  ${section(
    "9. Wage & Benefits",
    "9. الأجر والمزايا",
    [
      wageRow("9.1.1.1 Basic Wage:", "9.1.1.1 الأجر الأساسي :", w.basic),
      wageRow("9.1.1.2 Housing Allowance:", "9.1.1.2 بدل السكن :", w.housing),
      wageRow("9.1.1.3 Transportation Allowance:", "9.1.1.3 بدل النقل :", w.transport),
      wageRow(
        "9.1.1.5 Total Wage:",
        "9.1.1.5 إجمالي الأجر :",
        w.basic + w.housing + w.transport,
      ),
    ].join(""),
  )}
  ${section("15. Additional Terms", "15. شروط إضافية", "")}
  ${para("15.1 The Second Party shall keep the First Party's information confidential.", "15.1 يلتزم الطرف الثاني بالمحافظة على سرية معلومات الطرف الأول.")}
  <p style="text-align:center;color:#888">SYNTHETIC TEST CONTRACT - NOT A REAL DOCUMENT</p>`;
}

/** An offer letter: English with Arabic labels, like the real one in the project files. */
export function offerLetter(p: Person): string {
  return `<h1 style="font-size:16px">Example Trading Co. · Job Offer / عرض وظيفي</h1>
  <p>Dear ${p.name},</p><p>We are pleased to offer you the position below. Your total monthly
  package is <b>${sar(p.offerTotal!)} SAR</b> / إجمالي الراتب الشهري.</p>
  <p>Contract: fixed term, yearly. Probation: 90 days.</p>
  <p style="color:#888">SYNTHETIC TEST DOCUMENT</p>`;
}

/** The same offer, typed into an email body. */
export const offerText = (p: Person) =>
  `Hi,\n\nAs agreed with ${p.name} (ID ${p.id}), the total monthly package is ` +
  `${sar(p.offerTotal!)} SAR. Please prepare the Qiwa contract.\n\nThanks`;

export interface WageRow {
  person: Person;
  pay: Pay;
}

/** GOSI employee share for Saudis (9.75% of basic + housing); 0 for others. */
const deductions = ({ person, pay }: WageRow) =>
  person.nationality === "Saudi" ? Math.round((pay.basic + pay.housing) * 9.75) / 100 : 0;
const iban = (id: string) => `SA0380000000000000${id}`;

/** A Mudad-style wage file in the columns the API reads today, CRLF like Excel saves it. */
export function wageCsv(month: Month, rows: WageRow[]): Buffer {
  const head =
    "EmployeeID,EmployeeName,IBAN,BasicSalary,HousingAllowance,OtherAllowances,Deductions,NetSalary,PaymentDate";
  const lines = rows.map((r) => {
    const d = deductions(r);
    const { basic, housing, transport } = r.pay;
    return [
      r.person.id,
      r.person.name,
      iban(r.person.id),
      basic,
      housing,
      transport,
      d,
      total(r.pay) - d,
      `${month}-27`,
    ].join(",");
  });
  return Buffer.from("\uFEFF" + [head, ...lines].join("\r\n") + "\r\n");
}

/** The wage file HR actually edits: Arabic headers under a merged title row with a date. */
export async function wageXlsx(
  month: Month,
  prepared: string,
  rows: WageRow[],
): Promise<Buffer> {
  const heads = [
    "رقم الهوية",
    "اسم الموظف",
    "الراتب الأساسي",
    "بدل السكن",
    "بدلات أخرى",
    "الاستقطاعات",
    "صافي الراتب",
    "الآيبان",
  ];
  const title = {
    value: `مسير رواتب ${month} - أعد بتاريخ ${prepared}`,
    columnSpan: heads.length,
    fontWeight: "bold" as const,
  };
  const data = [
    [title, ...heads.slice(1).map(() => null)],
    heads.map((value) => ({ value, fontWeight: "bold" as const })),
    ...rows.map((r) => {
      const d = deductions(r);
      return [
        r.person.id,
        r.person.nameAr,
        r.pay.basic,
        r.pay.housing,
        r.pay.transport,
        d,
        total(r.pay) - d,
        iban(r.person.id),
      ].map((value) => ({ value }));
    }),
  ];
  return writeExcelFile(data, { rightToLeft: true }).toBuffer();
}

/** Unrelated paperwork that lands in the same places. */
export const noise = {
  invoice: () =>
    pdf(
      `<h1>TAX INVOICE / فاتورة ضريبية</h1><p>Office Supplies Co. · Invoice 4471 · 2,350.00 SAR incl. VAT</p>`,
    ),
  leave: (p: Person) =>
    pdf(
      `<h1>Leave request / طلب إجازة</h1><p>${p.name} (${p.id}) requests 5 days annual leave from 2026-09-14.</p>`,
    ),
  gosi: () =>
    pdf(
      `<h1>GOSI contribution statement</h1><p>Establishment 7000000001 · September 2026 · Total contributions 41,220.15 SAR</p>`,
    ),
  iqama: (p: Person) =>
    pdf(
      `<div style="border:2px solid #333;padding:20px;width:420px"><h2>Resident Identity / هوية مقيم</h2><p>${p.name}<br>${p.id}</p></div>`,
      true,
    ),
};

export interface Mail {
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  attachments?: { name: string; data: Buffer }[];
  /** Message-ID of the message this one replies to. */
  replyTo?: string;
}

const b64 = (data: Buffer | string) =>
  Buffer.from(data).toString("base64").replace(/.{76}/g, "$&\r\n");
const word = (text: string) =>
  /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`;
export const messageId = (n: number) => `<${n}@mail.example.test>`;

/** One .eml file, as an Outlook or IMAP export would save it. */
export function eml(id: number, m: Mail): Buffer {
  const boundary = `b${id}`;
  const parts = [
    `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(m.text)}`,
    ...(m.attachments ?? []).map(
      (a) =>
        `Content-Type: application/octet-stream; name="${word(a.name)}"\r\n` +
        `Content-Disposition: attachment; filename="${word(a.name)}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n${b64(a.data)}`,
    ),
  ];
  const head = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${word(m.subject)}`,
    `Date: ${new Date(m.date).toUTCString()}`,
    `Message-ID: ${messageId(id)}`,
    ...(m.replyTo ? [`In-Reply-To: ${m.replyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const body =
    parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("") + `--${boundary}--\r\n`;
  return Buffer.from(`${head.join("\r\n")}\r\n\r\n${body}`);
}
