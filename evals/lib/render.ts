import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { CaseSpec, type Bilingual, type CaseSpecInput } from "./case-spec";

const TEMPLATE_DIR = fileURLToPath(new URL("../template/", import.meta.url));

/** Playwright takes in/cm/mm/px, not pt. */
const pt = (points: number): string => `${(points / 72).toFixed(4)}in`;
/** A4 as the real Qiwa export prints it (595.92 x 841.92 pt). */
const PAGE = { width: pt(595.92), height: pt(841.92) };
const MARGIN = { top: pt(19), right: pt(23.3), bottom: pt(62), left: pt(23.3) };

export interface RenderOptions {
  /** Reuse a running browser when rendering many cases. One is launched and closed otherwise. */
  browser?: Browser;
}

/**
 * Renders a case spec to a synthetic Qiwa contract PDF with headless Chromium, the same engine
 * (Skia/PDF) that produced the real Qiwa export.
 */
export async function renderQiwaPdf(
  input: CaseSpecInput,
  outPath: string,
  options: RenderOptions = {},
): Promise<void> {
  const spec = CaseSpec.parse(input);
  const browser = options.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(renderQiwaHtml(spec), { waitUntil: "load" });
      await page.pdf({
        path: outPath,
        ...PAGE,
        margin: MARGIN,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: renderFooter(spec),
      });
    } finally {
      await page.close();
    }
  } finally {
    if (!options.browser) await browser.close();
  }
}

/** The filled-in contract HTML (without the per-page footer, which Chromium adds). */
export function renderQiwaHtml(input: CaseSpecInput | CaseSpec): string {
  const spec = CaseSpec.parse(input);
  // Comments document the placeholders, so they are dropped before filling.
  const template = readFileSync(`${TEMPLATE_DIR}qiwa.html`, "utf8").replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
  const css = readFileSync(`${TEMPLATE_DIR}qiwa.css`, "utf8");
  return fillTemplate(template, templateValues(spec), { css, ...templateSlots(spec) });
}

// ---------------------------------------------------------------------------------------------
// Template filling
// ---------------------------------------------------------------------------------------------

/**
 * Replaces {{key}} with the escaped value and {{{slot}}} with raw HTML. An unknown key throws,
 * so a typo in qiwa.html fails loudly instead of printing an empty field.
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
  slots: Record<string, string>,
): string {
  return template.replace(
    /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g,
    (_match, slot?: string, key?: string) => {
      if (slot !== undefined) {
        const html = slots[slot];
        if (html === undefined) throw new Error(`qiwa.html: unknown slot {{{${slot}}}}`);
        return html;
      }
      const value = key === undefined ? undefined : values[key];
      if (value === undefined) throw new Error(`qiwa.html: unknown field {{${key}}}`);
      return escapeHtml(value);
    },
  );
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bilingual(prefix: string, text: Bilingual): Record<string, string> {
  return { [`${prefix}.en`]: text.en, [`${prefix}.ar`]: text.ar };
}

function templateValues(spec: CaseSpec): Record<string, string> {
  const { contract, employer, employee, job, wage } = spec;
  const total = wage.total ?? wage.basic + wage.housing + wage.transport + wage.other;
  return {
    contractNumber: contract.number,
    ...bilingual("contractType", CONTRACT_TYPES[contract.type]),
    executionDate: qiwaDate(contract.executionDate),
    commencementDate: qiwaDate(contract.commencementDate),
    startDate: qiwaDate(contract.startDate ?? contract.commencementDate),
    ...bilingual("location", contract.location),

    ...bilingual("employerName", employer.name),
    ...bilingual("employerType", employer.type),
    unifiedNo: employer.unifiedNo,
    employerAddress: employer.nationalAddress,
    employerPhone: employer.phone,
    employerMobile: employer.mobile,
    employerEmail: employer.email,
    ...bilingual("signatoryName", employer.signatory.name),
    signatoryId: employer.signatory.idNo,
    ...bilingual("capacity", employer.signatory.capacity),
    ...bilingual("capacityDocument", employer.signatory.capacityDocument),

    employeeName: employee.name,
    ...bilingual("nationality", employee.nationality),
    ...bilingual(
      "idType",
      isSaudi(employee.nationality) ? ID_TYPES.saudi : ID_TYPES.resident,
    ),
    employeeId: employee.idNo,
    ...bilingual("gender", employee.gender),
    ...bilingual("maritalStatus", employee.maritalStatus),
    birthDate: qiwaDate(employee.birthDate),
    employeeAddress: employee.nationalAddress,
    ...bilingual("education", employee.education),
    ...bilingual("speciality", employee.speciality),
    employeeMobile: employee.mobile,
    employeeEmail: employee.email,

    ...bilingual("occupation", job.occupation),
    ...bilingual("jobTitle", job.jobTitle),
    ...bilingual("workDomain", job.workDomain),
    ...bilingual("workLocation", job.workLocation),
    ...bilingual("workType", job.workType),

    ...bilingual("period", periodClause(spec)),
    ...bilingual("probation", probationClause(spec)),
    ...bilingual("hours", hoursClause(spec)),
    leaveDays: String(spec.annualLeaveDays),

    ...bilingual("basic", monthly(wage.basic)),
    ...bilingual("housing", monthly(wage.housing)),
    ...bilingual("transport", monthly(wage.transport)),
    ...bilingual("total", monthly(total)),
    ...bilingual("dueDate", {
      en: `${ordinal(wage.dueDay)} of each month`,
      ar: `${wage.dueDay} من كل شهر`,
    }),

    ...bilingual("bankName", spec.bank.name),
    iban: spacedIban(spec.bank.iban),
    overtimePct: formatNumber(spec.overtimePremiumPct),

    createdBy: employer.signatory.name.ar,
    ...bilingual("createdAt", stamp(spec.footer.createdAt)),
    ...bilingual("activeAt", stamp(spec.footer.activeAt)),
  };
}

function templateSlots(spec: CaseSpec): Record<string, string> {
  const { contract, wage } = spec;
  const endDate =
    contract.type === "fixed_term"
      ? (contract.endDate ?? defaultEndDate(spec))
      : contract.endDate;
  return {
    endDateRow: endDate
      ? sharedRow("Contract end date:", qiwaDate(endDate), "تاريخ نهاية العقد :")
      : "",
    otherAllowanceRow:
      wage.other > 0
        ? pairRow(
            "9.1.1.4 Other Allowances:",
            monthly(wage.other),
            "9.1.1.4 بدلات أخرى :",
          )
        : "",
    section15Rows: spec.section15
      .map((clause, i) => textRow(`15.${i + 1} ${clause.en}`, `15.${i + 1} ${clause.ar}`))
      .join("\n"),
  };
}

function pairRow(labelEn: string, value: Bilingual, labelAr: string): string {
  return (
    `<div class="row pair"><div class="en label">${escapeHtml(labelEn)}</div>` +
    `<div class="en value">${escapeHtml(value.en)}</div><div class="ar value">${escapeHtml(value.ar)}</div>` +
    `<div class="ar label">${escapeHtml(labelAr)}</div></div>`
  );
}

function sharedRow(labelEn: string, value: string, labelAr: string): string {
  return (
    `<div class="row shared"><div class="en label">${escapeHtml(labelEn)}</div>` +
    `<div class="value">${escapeHtml(value)}</div><div class="ar label">${escapeHtml(labelAr)}</div></div>`
  );
}

function textRow(en: string, ar: string): string {
  return `<div class="row text"><p class="en">${escapeHtml(en)}</p><p class="ar">${escapeHtml(ar)}</p></div>`;
}

/** Per-page footer, as on the real export: who downloaded it and when, and the page number. */
function renderFooter(spec: CaseSpec): string {
  const [date, time] = spec.footer.downloadedAt.split(" ");
  const font =
    "font-family: 'DejaVu Sans', sans-serif; font-size: 7.5pt; line-height: 12.3pt; color: #333;";
  return `
    <div style="width: 100%; padding: 0 21.7pt 0.5pt; display: flex; justify-content: space-between; align-items: flex-end; ${font}">
      <div dir="rtl" style="text-align: left">
        <div>تم التحميل بتاريخ : <span dir="ltr">${escapeHtml(date ?? "")}</span> ${escapeHtml(time ?? "")}</div>
        <div>بواسطة : ${escapeHtml(spec.footer.downloadedByName)} - ${escapeHtml(spec.footer.downloadedById)}</div>
      </div>
      <div style="align-self: flex-start; font-size: 6pt">SYNTHETIC TEST CONTRACT - NOT A REAL DOCUMENT</div>
      <div dir="rtl">رقم العقد : ${escapeHtml(spec.contract.number)} | الصفحة <span class="pageNumber"></span> من <span class="totalPages"></span></div>
    </div>`;
}

// ---------------------------------------------------------------------------------------------
// Clause wording and value formats
// ---------------------------------------------------------------------------------------------

const CONTRACT_TYPES: Record<CaseSpec["contract"]["type"], Bilingual> = {
  fixed_term: { en: "Fixed-term Contract", ar: "عقد محدد المدة" },
  indefinite: { en: "Indefinite Contract", ar: "عقد غير محدد المدة" },
  specific_work: { en: "Contract for a Specific Work", ar: "عقد لأداء عمل معين" },
};

const ID_TYPES = {
  saudi: { en: "Nationality ID", ar: "هوية وطنية" },
  resident: { en: "Residence Permit (Iqama)", ar: "إقامة" },
} satisfies Record<string, Bilingual>;

function isSaudi(nationality: Bilingual): boolean {
  return nationality.en.trim().toLowerCase() === "saudi";
}

/** Clause 5.1 for each contract type. */
function periodClause(spec: CaseSpec): Bilingual {
  const { contract } = spec;
  if (contract.type === "indefinite") {
    return {
      en: "5.1 This contract is valid for an indefinite period, starting from the commencement date mentioned in Clause No. (1).",
      ar: "5.1 يسري هذا العقد لمدة غير محددة تبدأ من تاريخ مباشرة العمل المذكور في البند رقم (1).",
    };
  }
  if (contract.type === "specific_work") {
    return {
      en: "5.1 This contract is valid until the completion of the agreed work, starting from the commencement date mentioned in Clause No. (1).",
      ar: "5.1 يسري هذا العقد حتى إنجاز العمل المتفق عليه، ابتداءً من تاريخ مباشرة العمل المذكور في البند رقم (1).",
    };
  }
  const term = termText(contract.termMonths);
  const start = {
    en: `5.1 This contract is valid for a period of ${term.en}, starting from the commencement date mentioned in Clause No. (1),`,
    ar: `5.1 يسري هذا العقد لمدة ${term.ar} تبدأ من تاريخ مباشرة العمل المذكور في البند رقم (1)،`,
  };
  if (!contract.autoRenew) {
    return {
      en: `${start.en} and it will not be automatically renewed; it ends on the contract end date unless both parties agree to renew it through the Portal.`,
      ar: `${start.ar} ولا يتجدد تلقائيًا، وينتهي في تاريخ نهاية العقد ما لم يتفق الطرفان على تجديده عبر المنصة.`,
    };
  }
  const days = contract.renewalNoticeDays;
  return {
    en: `${start.en} and it will be automatically renewed for an equivalent period, unless one party notifies the other of their desire not to renew through the Portal, at least ${days} days before the contract end date.`,
    ar: `${start.ar} ويتجدد تلقائيًا لمدة مماثلة ما لم يُخطر أحد الطرفين الطرف الآخر برغبته في عدم التجديد من خلال المنصة، وذلك قبل ${days} يومًا على الأقل من تاريخ نهاية العقد.`,
  };
}

function termText(months: number): Bilingual {
  if (months % 12 === 0) {
    const years = months / 12;
    return { en: `${years} ${years === 1 ? "year" : "years"}`, ar: `${years} سنة` };
  }
  return { en: `${months} months`, ar: `${months} شهرًا` };
}

/** Clause 6.1. */
function probationClause(spec: CaseSpec): Bilingual {
  if (spec.probationDays === 0) {
    return {
      en: "6.1 The Second Party is not subject to a probationary period.",
      ar: "6.1 لا يخضع الطرف الثاني لفترة تجربة.",
    };
  }
  const days = spec.probationDays;
  const base = {
    en: `6.1 The Second Party is subject to a specified probationary period of ${days} days, starting from the commencement date of work.`,
    ar: `6.1 يخضع الطرف الثاني لفترة تجربة محددة مدتها ${days} يومًا تبدأ من تاريخ مباشرة العمل.`,
  };
  const excluded = [
    ...(spec.probationExcludesHolidays ? STANDARD_PROBATION_EXCLUSIONS : []),
    ...spec.probationExtraExclusions,
  ];
  if (excluded.length === 0) return base;
  return {
    en: `${base.en} The following days do not count towards this period: ${listEn(excluded.map((day) => day.en))}.`,
    ar: `${base.ar} ولا تُحتسب ضمنها الأيام التالية: ${listAr(excluded.map((day) => day.ar))}.`,
  };
}

/** The days Exec. Reg. Art. 19 allows to pause probation, as the Qiwa template lists them. */
const STANDARD_PROBATION_EXCLUSIONS: Bilingual[] = [
  { en: "Eid al-Fitr", ar: "إجازة عيد الفطر" },
  { en: "Eid al-Adha", ar: "إجازة عيد الأضحى" },
  { en: "National Day", ar: "اليوم الوطني" },
  { en: "Foundation Day", ar: "يوم التأسيس" },
  { en: "sick leave", ar: "الإجازة المرضية" },
];

/** "a", "a and b", "a, b, and c" (serial comma, as the template prints it). */
function listEn(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** "أ، وب، وج": every item after the first joined with "، و". */
function listAr(items: string[]): string {
  return items.join("، و");
}

/** Section 7. */
function hoursClause(spec: CaseSpec): Bilingual {
  const { workDaysPerWeek, dailyHours, restDaysPerWeek } = spec.hours;
  return {
    en: `Normal working days shall be ${workDaysPerWeek} days per week and working hours shall be daily ${formatNumber(dailyHours)}. In addition, the Second Party shall be entitled to ${restDaysPerWeek} rest days per week.`,
    ar: `تكون أيام العمل العادية ${workDaysPerWeek} أيام في الأسبوع، وساعات العمل ${formatNumber(dailyHours)} ساعات يوميًا، ويستحق الطرف الثاني ${restDaysPerWeek} يوم راحة في الأسبوع.`,
  };
}

/** "2025-01-31" → "2025/01/31", as Qiwa prints dates. */
export function qiwaDate(iso: string): string {
  return iso.replace(/-/g, "/");
}

/** "2025-01-31 09:00" → en "31/01/2025 | 09:00", ar "2025/01/31 | 09:00". */
function stamp(dateTime: string): Bilingual {
  const [date = "", time = ""] = dateTime.split(" ");
  const [year, month, day] = date.split("-");
  return {
    en: `${day}/${month}/${year} | ${time}`,
    ar: `${year}/${month}/${day} | ${time}`,
  };
}

function defaultEndDate(spec: CaseSpec): string {
  const [year, month, day] = spec.contract.commencementDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const end = new Date(Date.UTC(year, month - 1 + spec.contract.termMonths, day - 1));
  return end.toISOString().slice(0, 10);
}

/** 10000 → en "10,000.00 Monthly", ar "10,000.00 شهري". */
function monthly(amount: number): Bilingual {
  const text = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return { en: `${text} Monthly`, ar: `${text} شهري` };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function ordinal(day: number): string {
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}

/** "SA0000000000000000000000" → "SA 00 0000 0000 0000 0000 0000". */
export function spacedIban(iban: string): string {
  const digits = iban.slice(2);
  const groups = digits.slice(2).match(/.{1,4}/g) ?? [];
  return [iban.slice(0, 2), digits.slice(0, 2), ...groups].join(" ");
}
