import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkWages, type WageRecord } from "@rater/core";
import {
  eml,
  messageId,
  noise,
  offerLetter,
  offerText,
  pdf,
  qiwaContract,
  wageCsv,
  wageXlsx,
  type WageRow,
} from "./documents";
import { MONTHS, PEOPLE, total, type Month, type Person } from "./people";

/*
 * Writes three fake HR environments (see labor-rater/test-scenarios.md), each with an
 * expected.json answer key: pnpm --filter @rater/scenarios generate [out-dir]
 */

const OUT = process.argv[2] ?? "out";
const byId = (id: string) => PEOPLE.find((p) => p.id === id)!;
const withContract = PEOPLE.filter((p) => p.contract);
const withOffer = PEOPLE.filter((p) => p.offerTotal);

type Kind = "wage_file" | "qiwa_contract" | "offer_letter" | "offer_in_email";
interface FileKey {
  path: string;
  kind: Kind;
  month?: Month;
  /** Draft wage files are superseded by the final one of the same month. */
  draft?: boolean;
  employeeId?: string;
  /** Image-only PDF: no text layer to read. */
  scanned?: boolean;
}

// --- Shared documents -------------------------------------------------------------------------

const contracts = new Map(withContract.map((p) => [p.id, pdf(qiwaContract(p))]));
const SCANNED = byId("1000000034"); // its only copy is a scan
contracts.set(SCANNED.id, pdf(qiwaContract(SCANNED), true));
const offers = new Map(withOffer.map((p) => [p.id, pdf(offerLetter(p))]));

const rows = (month: Month): WageRow[] =>
  PEOPLE.flatMap((person) => {
    const pay = person.payroll[month];
    return pay ? [{ person, pay }] : [];
  });
/** The September draft, before the last edits: Omar's housing and Sara's pay intact, Noura in. */
function septemberDraft(): WageRow[] {
  const edited = new Set(["2000000014", "1000000015", "1000000018"]);
  const keep = (r: WageRow) => edited.has(r.person.id);
  return [...rows("2026-08").filter(keep), ...rows("2026-09").filter((r) => !keep(r))];
}

const wage = {
  julCsv: wageCsv("2026-07", rows("2026-07")),
  augXlsx: await wageXlsx("2026-08", "2026-08-23", rows("2026-08")),
  sepDraft: await wageXlsx("2026-09", "2026-09-20", septemberDraft()),
  sepFinal: await wageXlsx("2026-09", "2026-09-24", rows("2026-09")),
};

// --- Scenario builder -------------------------------------------------------------------------

function scenario(name: string, build: (put: Put) => void) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  const files: FileKey[] = [];
  const ignore: string[] = [];
  const write = (path: string, data: Buffer | string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), data);
  };
  const put: Put = (path, data, key) => {
    write(path, data);
    if (key) files.push({ path, ...key });
    else ignore.push(path);
  };
  let mailNo = 0;
  // A message is keyed by its parts ("<file>.eml#<attachment or body>"); one with none is noise.
  put.mail = (from, to, subject, date, text, parts = [], replyTo) => {
    const id = ++mailNo;
    const path = `mailbox/${String(id).padStart(3, "0")}.eml`;
    const attachments = parts.flatMap(({ name, data }) => (data ? [{ name, data }] : []));
    write(path, eml(id, { from, to, subject, date, text, attachments, replyTo }));
    for (const { name, key } of parts)
      if (key) files.push({ path: `${path}#${name}`, ...key });
    if (!parts.some((part) => part.key)) ignore.push(path);
    return messageId(id);
  };
  build(put);
  writeFileSync(
    join(dir, "expected.json"),
    JSON.stringify(
      { scenario: name, month: "2026-09", files, ignore, ...answer() },
      null,
      2,
    ),
  );
}

interface Put {
  (path: string, data: Buffer | string, key?: Omit<FileKey, "path">): void;
  mail: (
    from: string,
    to: string,
    subject: string,
    date: string,
    text: string,
    parts?: Part[],
    replyTo?: string,
  ) => string;
}

/** An attachment, or the body ("body", no data) when it carries something to collect. */
interface Part {
  name: string;
  data?: Buffer;
  key?: Omit<FileKey, "path">;
}
const part = (name: string, data?: Buffer, key?: Omit<FileKey, "path">) => ({
  name,
  data,
  key,
});

const contractKey = (p: Person, scanned = false) => ({
  kind: "qiwa_contract" as const,
  employeeId: p.id,
  ...(scanned && { scanned }),
});
const offerKey = (p: Person) => ({ kind: "offer_letter" as const, employeeId: p.id });
const wageKey = (month: Month, draft = false) => ({
  kind: "wage_file" as const,
  month,
  ...(draft && { draft }),
});

/** What a perfect harness collects for September, and what checkWages makes of it. */
function answer() {
  const record = (
    p: Person,
    pay: { basic: number | null; housing: number | null; transport: number | null },
    t: number | null,
  ): WageRecord => ({ employeeId: p.id, name: null, ...pay, total: t });
  const qiwa = withContract.map((p) => record(p, p.contract!, total(p.contract!)));
  const offerRecords = withOffer.map((p) =>
    record(p, { basic: null, housing: null, transport: null }, p.offerTotal!),
  );
  const payroll = rows("2026-09").map(({ person, pay }) => ({
    ...record(person, pay, total(pay)),
    name: person.name,
  }));
  return {
    records: { qiwa, offers: offerRecords, payroll },
    result: checkWages({ qiwa, offers: offerRecords, payroll }),
  };
}

// --- Scenarios 1 and 2: messy ----------------------------------------------------------------

/** Contracts only ever saved to the desktop, and two whose cloud copy is a placeholder. */
const DESKTOP_CONTRACTS = [
  "1000000013",
  "2000000014",
  "1000000023",
  "2000000024",
  "1000000025",
  "1000000026",
];
const PLACEHOLDER = ["2000000027", "1000000028"];
const HR = "Fatimah HR <hr@example.test>";
const PAYROLL = "Payroll Officer <payroll@example.test>";
const MANAGER = "Finance Manager <finance@example.test>";
const QIWA = "Qiwa Notifications <noreply@qiwa.example.test>";
const VENDOR = "Office Supplies <billing@supplies.example.test>";
const NEWS = "HR Weekly <news@hrweekly.example.test>";

function messy(synced: boolean) {
  return (put: Put) => {
    // Synced: the desktop lives inside OneDrive. Not synced: it's only on the PC.
    const desk = synced ? "cloud/Desktop" : "desktop";
    put(`${desk}/رواتب سبتمبر final.xlsx`, wage.sepFinal, wageKey("2026-09"));
    put(`${desk}/~$رواتب سبتمبر final.xlsx`, "Fatimah HR");
    put(
      `${desk}/desktop.ini`,
      "[.ShellClassInfo]\r\nLocalizedResourceName=@shell32.dll,-21769\r\n",
    );
    put(
      `${desk}/Payroll - Shortcut.lnk`,
      Buffer.from("4c0000000114020000000000c000000000000046", "hex"),
    );
    put(`${desk}/leave request.pdf`, noise.leave(byId("1000000011")));
    for (const id of DESKTOP_CONTRACTS) {
      put(
        `${desk}/عقود جديدة/${byId(id).name}.pdf`,
        contracts.get(id)!,
        contractKey(byId(id)),
      );
    }

    const cloud = "cloud/HR";
    put(`${cloud}/Payroll 2026/salaries jul.csv`, wage.julCsv, wageKey("2026-07"));
    put(`${cloud}/Payroll 2026/aug/رواتب أغسطس.xlsx`, wage.augXlsx, wageKey("2026-08"));
    put(
      `${cloud}/Payroll 2026/salaries sep.xlsx`,
      wage.sepDraft,
      wageKey("2026-09", true),
    );
    if (synced)
      put(
        `${cloud}/Payroll 2026/salaries sep-DESKTOP-HR01.xlsx`,
        wage.sepDraft,
        wageKey("2026-09", true),
      );
    put(`${cloud}/Payroll 2026/Thumbs.db`, Buffer.alloc(512, 7));
    let scan = 1;
    for (const p of withContract) {
      if (DESKTOP_CONTRACTS.includes(p.id)) continue;
      const scanned = p.id === SCANNED.id;
      if (PLACEHOLDER.includes(p.id) && !synced) {
        put(`${cloud}/عقود/${p.id}.pdf`, ""); // cloud-only, never downloaded
        continue;
      }
      // Half keep a sensible name; the rest came off the office scanner.
      const name =
        Number(p.id.slice(-1)) % 2
          ? `عقود/${p.id} - ${p.name}.pdf`
          : `New folder (3)/scan${String(scan++).padStart(4, "0")}.pdf`;
      put(`${cloud}/${name}`, contracts.get(p.id)!, contractKey(p, scanned));
    }
    for (const p of withOffer) {
      if (!p.offerInEmail)
        put(
          `${cloud}/Offers/Offer letter - ${p.name}.pdf`,
          offers.get(p.id)!,
          offerKey(p),
        );
    }
    put(`${cloud}/Finance/invoice 4471.pdf`, noise.invoice());
    put(`${cloud}/Finance/GOSI sep.pdf`, noise.gosi());

    const sep = "رواتب سبتمبر";
    const july = part("salaries jul.csv", wage.julCsv, wageKey("2026-07"));
    put.mail(PAYROLL, HR, "Salaries July", "2026-07-22", "Attached.", [july]);
    const draft = (name: string) => part(name, wage.sepDraft, wageKey("2026-09", true));
    const review = "مسودة رواتب سبتمبر للمراجعة.";
    const first = put.mail(PAYROLL, HR, sep, "2026-09-20", review, [
      draft("salaries sep.xlsx"),
    ]);
    const ask = "Check Omar's housing and Sara's basic before we send.";
    const second = put.mail(MANAGER, PAYROLL, `RE: ${sep}`, "2026-09-21", ask, [], first);
    const again = "Same file again, will fix on my desktop copy.";
    put.mail(
      PAYROLL,
      MANAGER,
      `RE: RE: ${sep}`,
      "2026-09-21T12:00",
      again,
      [draft("salaries sep final (2).xlsx")],
      second,
    );
    const forwarded = [...PLACEHOLDER, "1000000011"]
      .map(byId)
      .map((p) => part(`${p.contractNo}.pdf`, contracts.get(p.id), contractKey(p)));
    put.mail(QIWA, HR, "FW: عقود قوى", "2026-09-02", "Contracts attached.", forwarded);
    for (const p of withOffer.filter((x) => x.offerInEmail)) {
      const body = part("body", undefined, { kind: "offer_in_email", employeeId: p.id });
      put.mail(MANAGER, HR, `Offer - ${p.name}`, "2026-08-10", offerText(p), [body]);
    }
    const invoice = part("invoice.pdf", noise.invoice());
    put.mail(VENDOR, HR, "Invoice 4471", "2026-09-05", "Invoice attached.", [invoice]);
    const iqama = part("iqama.pdf", noise.iqama(byId("2000000012")));
    put.mail(HR, HR, "iqama renewal", "2026-09-08", "Scan for renewal.", [iqama]);
    put.mail(
      NEWS,
      HR,
      "This week in HR",
      "2026-09-12",
      "Five tips for a smoother payroll.",
    );
  };
}

// --- Scenario 3: organized HR with an ERP export ---------------------------------------------

function organized(put: Put) {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  for (const month of MONTHS) {
    const file = wageCsv(month, rows(month));
    put(`cloud/Payroll/${month}/WPS-${month}.csv`, file, wageKey(month));
    const wps = part(`WPS-${month}.csv`, file, wageKey(month));
    put.mail(PAYROLL, HR, `Payroll ready ${month}`, `${month}-24`, "WPS file attached.", [
      wps,
    ]);
    const paid = rows(month).map(({ person, pay }) => ({
      employeeId: person.id,
      ...pay,
    }));
    put(`erp/payroll-${month}.json`, json(paid), wageKey(month));
  }
  for (const p of withContract) {
    const data = p === SCANNED ? pdf(qiwaContract(p)) : contracts.get(p.id)!;
    put(`cloud/Contracts/${p.id}.pdf`, data, contractKey(p));
  }
  for (const p of withOffer)
    put(`cloud/Offers/${p.id}.pdf`, offers.get(p.id)!, offerKey(p));
  const staff = PEOPLE.map(({ id, name, nationality }) => ({ id, name, nationality }));
  put("erp/employees.json", json(staff));
  const terms = withContract.map((p) => ({
    employeeId: p.id,
    ...p.contract,
    offerTotal: p.offerTotal ?? null,
  }));
  // The whole roster's contract wages and offers in one file.
  put("erp/contracts.json", json(terms), { kind: "qiwa_contract" });
}

scenario("scenario-1-messy-not-synced", messy(false));
scenario("scenario-2-messy-synced", messy(true));
scenario("scenario-3-organized", organized);
console.log(`Wrote 3 scenarios to ${OUT}`);
