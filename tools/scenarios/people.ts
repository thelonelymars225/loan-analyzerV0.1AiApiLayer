/*
 * The fake company: the 12 people from labor-rater/mock-data (same planted September cases)
 * plus 18 clean ones. Everything here is made up.
 */

export const MONTHS = ["2026-07", "2026-08", "2026-09"] as const;
export type Month = (typeof MONTHS)[number];

export interface Pay {
  basic: number;
  housing: number;
  /** In a contract: transport. In payroll: every other allowance. */
  transport: number;
}

export interface Person {
  id: string;
  name: string;
  nameAr: string;
  nationality: string;
  contractNo: string;
  start: string;
  /** Null: paid through payroll without a Qiwa contract. */
  contract: Pay | null;
  /** Total promised in the offer letter, when there is one. */
  offerTotal?: number;
  /** The offer is typed into an email instead of attached as a PDF. */
  offerInEmail?: boolean;
  /** What payroll pays per month; a missing month means not in that wage file. */
  payroll: Partial<Record<Month, Pay>>;
}

const split = (basic: number, housing = basic / 4, transport = basic / 10): Pay => ({
  basic,
  housing: Math.round(housing),
  transport: Math.round(transport),
});
const every = (pay: Pay) => ({ "2026-07": pay, "2026-08": pay, "2026-09": pay });
const total = (pay: Pay) => pay.basic + pay.housing + pay.transport;

function person(
  id: string,
  name: string,
  nameAr: string,
  contract: Pay | null,
  extra: Partial<Person> = {},
): Person {
  const nationality = id.startsWith("1") ? "Saudi" : "Non-Saudi";
  const start = `2025-${String((Number(id.slice(-2)) % 12) + 1).padStart(2, "0")}-01`;
  const payroll = contract ? every(contract) : {};
  return {
    id,
    name,
    nameAr,
    nationality,
    contractNo: `5${id.slice(1)}`,
    start,
    contract,
    payroll,
    ...extra,
  };
}

const sara = split(11111, 2778, 1111);
const john = split(5000, 1250, 500);
const raised = split(5500, 1375, 550);

/** The planted cases, as in labor-rater/mock-data/README.md. */
const planted: Person[] = [
  person("1000000011", "Ahmed Al-Mock", "أحمد الموك", sara, { offerTotal: 15000 }),
  person("2000000012", "Ravi Sample", "رافي سامبل", split(6000, 1500, 500), {
    offerTotal: 8000,
  }),
  person("1000000013", "Khalid Test", "خالد التجربة", split(10000, 2500, 1000)),
  person("2000000014", "Omar Example", "عمر المثال", split(7000, 1750, 700)),
  person("1000000015", "Sara Demo", "سارة العرض", sara, { offerTotal: 15000 }),
  person("2000000016", "John Placeholder", "جون بليسهولدر", john),
  person("2000000017", "Ali Fixture", "علي الثابت", null),
  person("1000000018", "Noura Sample", "نورة العينة", split(9000, 2250, 900)),
  person("2000000019", "Hassan Mock", "حسن الموك", split(4000, 1000, 400)),
  person("1000000020", "Fahad Test", "فهد التجربة", split(8000, 2000, 800)),
  person("2000000021", "Maria Example", "ماريا المثال", split(6000, 1500, 600)),
  person("1000000022", "Reem Demo", "ريم العرض", split(12000, 3000, 1200), {
    offerTotal: 17000,
    offerInEmail: true,
  }),
];

const sep = (id: string, pay: Pay | undefined) => {
  const p = planted.find((x) => x.id === id)!;
  if (pay) p.payroll["2026-09"] = pay;
  else delete p.payroll["2026-09"];
};
sep("1000000013", split(9000, 2500, 2000)); // basic cut, moved into allowances
sep("2000000014", split(7000, 0, 700)); // housing dropped
sep("1000000015", split(10000, 2500, 1000)); // underpaid 1,500
planted.find((x) => x.id === "2000000016")!.payroll = {
  "2026-07": john,
  "2026-08": raised,
  "2026-09": raised,
};
planted.find((x) => x.id === "2000000017")!.payroll = every(split(4000, 1000, 400));
sep("1000000018", undefined); // missing from September
sep("2000000021", split(6000, 1500, 1850)); // one-off overtime: not an issue

const CLEAN: [string, string][] = [
  ["Abdullah Al-Fake", "عبدالله المزيف"],
  ["Priya Dummy", "بريا دمي"],
  ["Lama Stub", "لمى الافتراضية"],
  ["Yousef Mockup", "يوسف النموذج"],
  ["Jose Sample", "خوسيه سامبل"],
  ["Hind Example", "هند المثال"],
  ["Saad Testcase", "سعد الحالة"],
  ["Anil Fixture", "أنيل فكستشر"],
  ["Rawan Draft", "روان المسودة"],
  ["Turki Seed", "تركي البذرة"],
  ["Grace Filler", "غريس فيلر"],
  ["Nasser Proto", "ناصر الأولي"],
  ["Mona Sandbox", "منى التجريبية"],
  ["Kumar Demo", "كومار ديمو"],
  ["Faisal Synthetic", "فيصل المصطنع"],
  ["Dana Specimen", "دانة العينة"],
  ["Bilal Template", "بلال القالب"],
  ["Asma Placeholder", "أسماء البديل"],
];

const clean = CLEAN.map(([name, nameAr], i) => {
  const id = `${i % 3 === 1 ? 2 : 1}0000000${23 + i}`;
  const pay = split(4000 + ((i * 1350) % 9000));
  // Every third person has an offer letter; one of them only in an email body.
  const offer = i % 3 === 0 ? { offerTotal: total(pay), offerInEmail: i === 9 } : {};
  return person(id, name, nameAr, pay, offer);
});

export const PEOPLE: Person[] = [...planted, ...clean];
export { total };
