import { readFileSync } from "node:fs";
import { z } from "zod";
import { LawArticle, RulesFile } from "@rater/contracts";

/** Paths are relative to this file, so loading works the same under tsx, vitest and the worker. */
const RULES_PATH = new URL("../rules/rules.json", import.meta.url);
const CORPUS_PATH = new URL("../corpus/articles.json", import.meta.url);

/**
 * A corpus entry on disk. `note` records provenance (which source each language came from,
 * what was rebuilt or summarised) for maintainers; it is dropped when loading.
 */
export const CorpusEntry = LawArticle.extend({ note: z.string().optional() });
export type CorpusEntry = z.infer<typeof CorpusEntry>;

let cachedRules: RulesFile | undefined;
let cachedCorpus: LawArticle[] | undefined;

function readJson(path: URL): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertUniqueRuleIds(rules: RulesFile): void {
  const seen = new Set<string>();
  for (const rule of rules.rules) {
    if (seen.has(rule.id)) throw new Error(`rules.json: duplicate rule id ${rule.id}`);
    seen.add(rule.id);
  }
}

/** The rules table, validated against RulesFile. Read once per process. */
export function loadRules(): RulesFile {
  if (!cachedRules) {
    const rules = RulesFile.parse(readJson(RULES_PATH));
    assertUniqueRuleIds(rules);
    cachedRules = rules;
  }
  return cachedRules;
}

/** The law corpus, validated against LawArticle. Read once per process. */
export function loadCorpus(): LawArticle[] {
  if (!cachedCorpus) {
    const entries = z.array(CorpusEntry).parse(readJson(CORPUS_PATH));
    cachedCorpus = entries.map(({ note: _note, ...article }) => article);
  }
  return cachedCorpus;
}
