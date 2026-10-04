import type { CaseSpecInput } from "../lib/case-spec";

/**
 * Synthetic contracts rendered into packages/core/test/fixtures/ (see README.md).
 * The core extraction tests assert on these exact values, so change both together.
 */
export const FIXTURE_CASES: CaseSpecInput[] = [
  {
    // Same shape as the calibration contract: fixed-term, auto-renewing, with a Section 15 that
    // contradicts the contract type and undercuts end-of-service and compensation.
    id: "fixed-term-bad-s15",
    contract: {
      number: "10000011",
      type: "fixed_term",
      executionDate: "2025-03-01",
      commencementDate: "2025-03-02",
      termMonths: 12,
      autoRenew: true,
      renewalNoticeDays: 30,
    },
    employer: {
      name: { en: "Example Trading Co.", ar: "شركة المثال للتجارة" },
      signatory: {
        name: { en: "Fahad Al-Mithali", ar: "فهد المثالي" },
        idNo: "1000000012",
      },
    },
    employee: {
      name: "نور الحربي",
      idNo: "1000000011",
      email: "nour.h@example.com",
      mobile: "+966 55 000 0011",
    },
    probationDays: 180,
    hours: { workDaysPerWeek: 5, dailyHours: 8, restDaysPerWeek: 2 },
    annualLeaveDays: 22,
    wage: { basic: 11000, housing: 2750, transport: 1100 },
    overtimePremiumPct: 50,
    section15: [
      {
        en: "This contract is for an unlimited period and ends upon completion of the project in accordance with Article 57 of the Labor Law.",
        ar: "هذا العقد لمدة غير محددة، وينتهي عند إنجاز المشروع وفقًا للمادة (57) من نظام العمل.",
      },
      {
        en: "The employee shall not disclose any information about the employer's business at any time, during or after employment.",
        ar: "لا يجوز للموظف الإفصاح عن أي معلومات تخص أعمال صاحب العمل في أي وقت، سواء أثناء العمل أو بعد انتهائه.",
      },
      {
        en: "The employer may transfer the employee to any of its branches or projects anywhere in the Kingdom.",
        ar: "يجوز لصاحب العمل نقل الموظف إلى أي من فروعه أو مشاريعه في أي مكان داخل المملكة.",
      },
      {
        en: "If either party terminates this contract before its expiry without a valid reason, it shall pay the other party compensation equal to two months of basic wage.",
        ar: "إذا أنهى أحد الطرفين هذا العقد قبل انتهاء مدته دون سبب مشروع، التزم بأن يدفع للطرف الآخر تعويضًا يعادل أجر شهرين من الأجر الأساسي.",
      },
      {
        en: "Annual leave must be taken within the same calendar year and may not be carried forward.",
        ar: "يجب استنفاد الإجازة السنوية خلال السنة الميلادية نفسها، ولا يجوز ترحيلها.",
      },
      {
        en: "The end-of-service award shall be calculated on the basis of the basic salary only.",
        ar: "تُحسب مكافأة نهاية الخدمة على أساس الراتب الأساسي فقط.",
      },
      {
        en: "This contract supersedes all prior agreements between the parties.",
        ar: "يحل هذا العقد محل جميع الاتفاقيات السابقة بين الطرفين.",
      },
    ],
    // Downloaded by someone from HR, not the employee.
    footer: {
      downloadedAt: "2026-02-10 08:15",
      downloadedByName: "سارة العتيبي",
      downloadedById: "1000000013",
    },
  },
  {
    // A clean, indefinite contract for a non-Saudi employee. Should score 85+.
    id: "indefinite-clean",
    contract: {
      number: "10000021",
      type: "indefinite",
      executionDate: "2024-06-01",
      commencementDate: "2024-06-15",
    },
    employer: {
      name: { en: "Sample Logistics LLC", ar: "شركة العينة للخدمات اللوجستية" },
      email: "people@sample-logistics.example",
      signatory: {
        name: { en: "Khalid Al-Namuthaji", ar: "خالد النموذجي" },
        idNo: "1000000022",
      },
    },
    employee: {
      name: "Omar Haddad",
      nationality: { en: "Egyptian", ar: "مصري" },
      idNo: "2000000021",
      gender: { en: "Male", ar: "ذكر" },
      maritalStatus: { en: "Married", ar: "متزوج" },
      email: "omar.haddad@example.com",
      mobile: "+966 56 000 0021",
    },
    job: {
      occupation: { en: "Accountant", ar: "محاسب" },
      jobTitle: { en: "Senior Accountant", ar: "محاسب أول" },
      workLocation: { en: "Jeddah", ar: "جدة" },
    },
    probationDays: 90,
    hours: { workDaysPerWeek: 5, dailyHours: 8, restDaysPerWeek: 2 },
    annualLeaveDays: 30,
    wage: { basic: 8000, housing: 2000, transport: 800 },
    overtimePremiumPct: 50,
    section15: [
      {
        en: "The end-of-service award shall be calculated on the last actual wage in accordance with the Labor Law.",
        ar: "تُحسب مكافأة نهاية الخدمة على أساس آخر أجر فعلي وفقًا لنظام العمل.",
      },
      {
        en: "For 12 months after the contract ends, the employee shall not work for a direct competitor in Riyadh in a software sales role with access to the employer's clients.",
        ar: "لا يجوز للموظف خلال 12 شهرًا من انتهاء العقد العمل لدى منافس مباشر في الرياض في وظيفة مبيعات برمجيات يطلع فيها على عملاء صاحب العمل.",
      },
      {
        en: "The employee shall comply with the company dress code and internal policies.",
        ar: "يلتزم الموظف بقواعد اللباس والسياسات الداخلية للشركة.",
      },
    ],
    footer: {
      downloadedAt: "2026-02-11 19:40",
      downloadedByName: "Omar Haddad",
      downloadedById: "2000000021",
    },
  },
  {
    // Wage parts that do not add up to the printed total (must be needs_review), an "Other
    // Allowances" row, a 2-year term without auto-renewal, and a clause carrying contact details.
    id: "wage-mismatch",
    contract: {
      number: "10000031",
      type: "fixed_term",
      executionDate: "2025-09-20",
      commencementDate: "2025-10-01",
      termMonths: 24,
      autoRenew: false,
    },
    employee: {
      name: "هدى القحطاني",
      idNo: "1000000031",
      email: "huda.q@example.com",
      mobile: "+966 55 000 0031",
    },
    probationDays: 120,
    hours: { workDaysPerWeek: 6, dailyHours: 8, restDaysPerWeek: 1 },
    annualLeaveDays: 21,
    wage: { basic: 9000, housing: 2250, transport: 900, other: 500, total: 13000 },
    overtimePremiumPct: 50,
    section15: [
      {
        en: "Overtime shall be compensated at 25% of the basic hourly wage.",
        ar: "يُعوَّض العمل الإضافي بنسبة 25% من أجر الساعة الأساسي.",
      },
      {
        en: "The employee shall work additional hours whenever business needs require.",
        ar: "يلتزم الموظف بالعمل ساعات إضافية كلما اقتضت حاجة العمل ذلك.",
      },
      {
        en: "Notices from Example Trading Co. to the employee may also be sent by text message to 0550000031 or by e-mail to huda.q@example.com.",
        ar: "يجوز لشركة المثال للتجارة إرسال الإشعارات إلى الموظفة هدى القحطاني برسالة نصية على الرقم 0550000031 أو بالبريد الإلكتروني huda.q@example.com.",
      },
    ],
    footer: {
      downloadedAt: "2026-02-12 12:05",
      downloadedByName: "هدى القحطاني",
      downloadedById: "1000000031",
    },
  },
];

/** A document that is not a Qiwa contract, for the detection test. */
export const NOT_QIWA_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Offer letter (synthetic)</title>
<style>
  body { font-family: "Liberation Sans", Arial, sans-serif; font-size: 11pt; margin: 48pt; }
  .ar { direction: rtl; font-family: "DejaVu Sans", sans-serif; }
</style></head>
<body>
  <h1>Offer of Employment</h1>
  <p class="ar">خطاب عرض وظيفي</p>
  <p>Example Trading Co. is pleased to offer you the position of Software Engineer.</p>
  <p>Monthly basic salary: SAR 10,000. Housing allowance: SAR 2,500.</p>
  <p>This letter is not an employment contract. Your employment contract will be issued separately.</p>
  <p>SYNTHETIC TEST DOCUMENT - NOT A REAL OFFER</p>
</body></html>`;
