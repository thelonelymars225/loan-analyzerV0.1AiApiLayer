import { readFileSync } from "node:fs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { WageCheckResponse } from "@rater/contracts";
import {
  checkWages,
  extractContract,
  parseBboxXhtml,
  readContractsCsv,
  readPayrollCsv,
  WageFileError,
  type WageRecord,
} from "@rater/core";
import { pdftotextBbox } from "@rater/pdf";
import type { AppDeps } from "../deps";
import { unsupportedDocument, validationError } from "../errors";
import { checkQiwaPdf, readFile } from "../ratings/upload";

const OFFER_FIELDS = {
  offerBasic: "basic",
  offerHousing: "housing",
  offerTransport: "transport",
  offerTotal: "total",
} as const;

/** A bare page for trying the API by hand; not the product UI. */
const TEST_PAGE = readFileSync(
  new URL("./wage-check-page.html", import.meta.url),
  "utf8",
);

/**
 * The wage check: compares each person's Qiwa contract with the payroll (Mudad wage file) and,
 * when given, the offer letter. Nothing is stored: the files are read, compared and dropped.
 */
export const wageCheckRoutes: FastifyPluginAsyncZod<AppDeps> = async (
  app,
  { config },
) => {
  app.get(
    "/wage-checks/test",
    { config: { public: true }, schema: { hide: true } },
    async (_request, reply) => reply.type("text/html; charset=utf-8").send(TEST_PAGE),
  );

  app.post(
    "/wage-checks",
    {
      schema: {
        summary: "Compare Qiwa contracts, offer letters and a payroll file",
        description:
          'multipart/form-data. "payroll": the Mudad wage file (CSV). Then either "contract": ' +
          'one Qiwa contract PDF, with its offer letter as optional fields "offerBasic", ' +
          '"offerHousing", "offerTransport" and "offerTotal"; or "contracts": a CSV with one ' +
          'row per person and source ("qiwa" or "offline" for the offer letter). People are ' +
          "matched by national ID or iqama number.",
        consumes: ["multipart/form-data"],
        response: { 200: WageCheckResponse },
      },
    },
    async (request) => {
      const form = await readForm(request, config.MAX_UPLOAD_BYTES);
      const payrollCsv = form.files.get("payroll");
      if (!payrollCsv) throw validationError('Send the wage file (CSV) in "payroll".');
      const contractPdf = form.files.get("contract");
      const contractsCsv = form.files.get("contracts");
      if (!contractPdf === !contractsCsv) {
        throw validationError(
          'Send either a Qiwa PDF in "contract" or a CSV in "contracts".',
        );
      }
      try {
        const payroll = readPayrollCsv(payrollCsv.toString("utf8"));
        if (contractsCsv) {
          return checkWages({
            ...readContractsCsv(contractsCsv.toString("utf8")),
            payroll,
          });
        }
        const qiwa = await readQiwaWage(contractPdf as Buffer);
        const offer = offerFrom(form.fields, qiwa);
        return checkWages({ qiwa: [qiwa], offers: offer ? [offer] : [], payroll });
      } catch (error) {
        if (error instanceof WageFileError) throw validationError(error.message);
        throw error;
      }
    },
  );
};

/** The wage and the employee's ID from a Qiwa contract PDF. */
async function readQiwaWage(pdf: Buffer): Promise<WageRecord> {
  await checkQiwaPdf(pdf);
  const extraction = extractContract(parseBboxXhtml(await pdftotextBbox(pdf)));
  const { wage } = extraction.fields;
  if (!extraction.employeeId || !wage) {
    throw unsupportedDocument("The employee's ID number or wage could not be read.");
  }
  // "Other" fixed allowances in the contract count toward transport, like payroll does.
  return {
    employeeId: extraction.employeeId,
    name: null,
    basic: wage.basic,
    housing: wage.housing,
    transport: wage.transport + wage.other,
    total: wage.total,
  };
}

function offerFrom(fields: Map<string, string>, qiwa: WageRecord): WageRecord | null {
  const offer: WageRecord = {
    ...qiwa,
    basic: null,
    housing: null,
    transport: null,
    total: null,
  };
  let given = false;
  for (const [name, part] of Object.entries(OFFER_FIELDS)) {
    const raw = fields.get(name)?.replace(/[,\s]/g, "");
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0)
      throw validationError(`"${name}" must be a number.`);
    offer[part] = value;
    given = true;
  }
  return given ? offer : null;
}

/** Every file and field of a multipart form, each file at most `maxBytes`. */
async function readForm(request: FastifyRequest, maxBytes: number) {
  if (!request.isMultipart()) throw validationError("Send multipart/form-data.");
  const files = new Map<string, Buffer>();
  const fields = new Map<string, string>();
  const parts = request.parts({ limits: { fileSize: maxBytes, files: 3, fields: 10 } });
  for await (const part of parts) {
    if (part.type === "field") {
      fields.set(part.fieldname, String(part.value));
      continue;
    }
    files.set(part.fieldname, await readFile(part, maxBytes));
  }
  return { files, fields };
}
