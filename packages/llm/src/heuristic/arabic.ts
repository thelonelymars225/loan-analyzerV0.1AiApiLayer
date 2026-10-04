import { normaliseEnglish } from "./text";

/*
 * Arabic support for the offline analyser. When a clause has no English text, its Arabic is
 * turned into a rough English gloss phrase by phrase, so the same English detectors can read
 * it. Best effort: confidence is capped at medium for anything found this way.
 */

/** Letters folded together so OCR and spelling variants compare equal. */
export function normaliseArabicText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "") // bidi controls
    .replace(/\u0640/g, "") // tatweel
    .replace(/\p{Mn}/gu, "") // diacritics: harakat, shadda, superscript alef
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // alef forms
    .replace(/\u0649/g, "\u064a") // alef maqsura
    .replace(/\u0629/g, "\u0647") // ta marbuta
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066a/g, "%")
    .replace(/\u060c/g, ",")
    .replace(/\u061b/g, ";")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Arabic phrases (as written in contracts, before normalisation) and the English the detectors
 * look for. Longer phrases are applied first, so "بدل النقل" (transport allowance) is not read
 * as "نقل" (transfer). Keys with spaces at the ends only match whole words. Keys are normalised
 * like the text, so one spelling covers variants with diacritics or other alef forms.
 */
const GLOSSARY: [string, string][] = [
  // End of service and wage
  ["مكافأة نهاية الخدمة", "end-of-service award"],
  ["نهاية الخدمة", "end-of-service"],
  ["الأجر الأساسي", "basic salary"],
  ["الراتب الأساسي", "basic salary"],
  ["أجر أساسي", "basic salary"],
  ["راتب أساسي", "basic salary"],
  ["الأجر الفعلي", "last actual wage"],
  ["آخر أجر", "last actual wage"],
  ["الأجر الأخير", "last actual wage"],
  ["إجمالي الأجر", "total wage"],
  ["الأجر الإجمالي", "total wage"],
  ["الراتب الإجمالي", "total wage"],
  ["بدل السكن", "housing allowance"],
  ["بدل النقل", "transport allowance"],
  ["البدلات", "allowances"],
  [" فقط ", "only"],
  ["وفقا لنظام العمل", "in accordance with the labor law"],
  ["حسب نظام العمل", "in accordance with the labor law"],
  ["طبقا لنظام العمل", "in accordance with the labor law"],
  ["نظام العمل", "the labor law"],
  ["المادة السابعة والخمسين", "article 57"],
  ["المادة 57", "article 57"],
  // Ending the contract and compensation
  ["دون سبب مشروع", "without a valid reason"],
  ["بدون سبب مشروع", "without a valid reason"],
  ["لغير سبب مشروع", "without a valid reason"],
  ["قبل انتهاء مدته", "before its expiry"],
  ["قبل انتهاء العقد", "before its expiry"],
  ["إنهاء العقد", "terminates the contract"],
  ["فسخ العقد", "terminates the contract"],
  ["إنهاء", "termination"],
  ["أنهى", "terminates"],
  ["ينهي", "terminates"],
  ["دون تعويض", "without compensation"],
  ["بدون تعويض", "without compensation"],
  ["بلا تعويض", "without compensation"],
  ["تعويض", "compensation"],
  ["يعوض", "compensate"],
  // Durations
  ["شهرين", "two months"],
  ["شهران", "two months"],
  ["ثلاثة أشهر", "three months"],
  ["ثلاثة شهور", "three months"],
  ["أربعة أشهر", "four months"],
  ["ستة أشهر", "six months"],
  ["تسعة أشهر", "nine months"],
  ["شهر واحد", "one month"],
  ["سنتين", "two years"],
  ["سنتان", "two years"],
  ["عامين", "two years"],
  ["ثلاث سنوات", "three years"],
  ["ثلاثة أعوام", "three years"],
  ["سنة واحدة", "one year"],
  ["خمسة عشر", "fifteen"],
  ["أشهر", "months"],
  ["شهور", "months"],
  ["شهرا", "months"],
  ["سنوات", "years"],
  ["أعوام", "years"],
  ["يوما", "days"],
  ["أيام", "days"],
  [" يوم ", "days"],
  ["ساعات", "hours"],
  ["ساعة", "hours"],
  ["يوميا", "a day"],
  ["في اليوم", "a day"],
  ["أسبوعيا", "a week"],
  ["في الأسبوع", "a week"],
  // Transfer
  ["أي مدينة", "any city"],
  ["أي من فروعها", "any of its branches"],
  ["أي فرع", "any branch"],
  ["أي موقع", "any location"],
  ["أي من مشاريعها", "any of its projects"],
  ["أي من مواقع", "any of the sites"],
  ["أي مشروع", "any project"],
  ["أي منطقة", "any region"],
  ["داخل المملكة", "within the kingdom"],
  ["أنحاء المملكة", "throughout the kingdom"],
  ["نقل", "transfer"],
  ["حسب التكليف", "as assigned"],
  // Non-compete, confidentiality
  ["بعد انتهاء العقد", "after the contract ends"],
  ["بعد انتهاء عقد العمل", "after the contract ends"],
  ["بعد انتهاء علاقة العمل", "after the contract ends"],
  ["بعد انتهاء الخدمة", "after the contract ends"],
  ["من انتهاء العقد", "after the contract ends"],
  ["منافسة", "competitor"],
  ["منافس", "competitor"],
  ["عملاء صاحب العمل", "the employer's clients"],
  ["الاطلاع على", "access to"],
  ["الوصول إلى", "access to"],
  ["يطلع فيها على", "with access to"],
  ["يطلع على", "has access to"],
  ["العملاء", "clients"],
  ["وظيفة", "role"],
  ["في الرياض", "in riyadh"],
  ["في جدة", "in jeddah"],
  ["في الدمام", "in dammam"],
  ["السرية", "confidential"],
  ["سرية", "confidential"],
  ["إفشاء", "disclose"],
  ["الإفصاح", "disclose"],
  ["أسرار", "secrets"],
  ["في أي وقت", "at any time"],
  ["أثناء العمل أو بعده", "during or after employment"],
  ["دون تحديد مدة", "without time limit"],
  ["لا يحق للموظف", "the employee is not allowed to"],
  ["لا يجوز للموظف", "the employee is not allowed to"],
  ["مشاركة", "share"],
  ["معلومات", "information"],
  ["مستندات", "documents"],
  ["مع الغير", "with others"],
  // Leave
  ["الإجازة السنوية", "annual leave"],
  ["إجازة سنوية", "annual leave"],
  ["رصيد الإجازات", "leave balance"],
  ["تسقط", "is forfeited"],
  ["يسقط", "is forfeited"],
  ["لا يجوز ترحيل", "may not be carried forward"],
  ["لا ترحل", "may not be carried forward"],
  ["ترحيل", "carried forward"],
  ["نفس السنة", "the same calendar year"],
  ["السنة نفسها", "the same calendar year"],
  // Overtime and hours
  ["ساعات العمل الإضافية", "overtime hours"],
  ["ساعة عمل إضافية", "overtime hour"],
  ["العمل الإضافي", "overtime"],
  ["ساعات إضافية", "additional hours"],
  ["إجازة بدل", "time off in lieu"],
  ["راحة بدل", "time off in lieu"],
  ["إجازة تعويضية", "time off in lieu"],
  ["حسب حاجة العمل", "whenever business needs require"],
  ["وفق حاجة العمل", "whenever business needs require"],
  ["عند الحاجة", "whenever business needs require"],
  ["كلما اقتضت حاجة العمل", "whenever business needs require"],
  ["متى ما تطلب العمل", "whenever the work requires"],
  ["بعد انتهاء ساعات العمل الرسمية", "beyond normal working hours"],
  ["تقدير صاحب العمل", "the employer's discretion"],
  ["بموافقة العامل", "with the employee's consent"],
  ["موافقة العامل", "the employee's consent"],
  ["الأجر الأساسي للساعة", "basic hourly wage"],
  ["أجر الساعة الأساسي", "basic hourly wage"],
  ["ساعات العمل", "working hours"],
  // Probation and contract type
  ["فترة التجربة", "probationary period"],
  ["تمديد", "extended"],
  ["مدة غير محددة", "unlimited period"],
  ["غير محدد المدة", "unlimited period"],
  ["محدد المدة", "fixed-term"],
  ["بانتهاء المشروع", "ends upon completion of the project"],
  ["انتهاء المشروع", "ends upon completion of the project"],
  ["إنجاز المشروع", "ends upon completion of the project"],
  ["المشروع", "the project"],
  ["العقد", "the contract"],
  ["عقد", "contract"],
];

/** Normalised glossary, longest Arabic phrase first. */
const NORMALISED_GLOSSARY = GLOSSARY.map(([arabic, english]): [string, string] => [
  glossKey(arabic),
  english,
]).sort(([a], [b]) => b.length - a.length);

function glossKey(arabic: string): string {
  const padStart = arabic.startsWith(" ") ? " " : "";
  const padEnd = arabic.endsWith(" ") ? " " : "";
  return `${padStart}${normaliseArabicText(arabic)}${padEnd}`;
}

/** A rough English reading of an Arabic clause, normalised like English clause text. */
export function glossArabic(text: string): string {
  let glossed = ` ${normaliseArabicText(text)} `;
  for (const [arabic, english] of NORMALISED_GLOSSARY) {
    glossed = glossed.split(arabic).join(` ${english} `);
  }
  return normaliseEnglish(glossed);
}
