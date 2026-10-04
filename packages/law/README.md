# @rater/law

The rules table, the law corpus, and the lookup the rating engine uses to cite articles.

| Path                             | What it is                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules/rules.json`               | The rules table (`RulesFile`). One entry per check. Code implements only the check function named by the rule ID.                                                 |
| `corpus/articles.json`           | The law corpus (`LawArticle[]`): Labor Law articles (one entry per article, or per paragraph for long ones), Implementing Regulations, and Qiwa template clauses. |
| `src/load.ts`                    | `loadRules()`, `loadCorpus()`: read and validate the JSON once per process.                                                                                       |
| `src/citation.ts`                | `formatCitation()`: "Art. 83(1)", "Exec. Reg. Art. 20", "Contract cl. 14.5". `packages/core` keeps an identical copy.                                             |
| `src/embedder.ts`, `src/text.ts` | `HashEmbedder`: an offline embedder (feature hashing of normalised words and character trigrams, Arabic-aware).                                                   |
| `src/lookup.ts`                  | `MemoryArticleLookup`: `byRefs()` for rule-first lookup, `search()` for vector search as the backstop.                                                            |
| `src/ingest.ts`                  | CLI that embeds the corpus and upserts it into `law_articles`.                                                                                                    |

## Ingest

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/rater pnpm law:ingest
```

Re-running is safe: rows have stable IDs (`law_2025-11_labor_law_83_1`) and are updated in place.
Rows of the same law version that are no longer in the corpus are removed.

## Editing the data

- **A rule changes:** edit `rules/rules.json` and bump `RULESET_VERSION` (in `src/versions.ts`
  and the file) so cached clause analyses are redone. Every `articleRefs` entry must resolve to a
  corpus article, and every citation in `articles` must be backed by an `articleRefs` entry
  (the tests check both).
- **An article changes:** edit `corpus/articles.json`. Arabic is the official text (`textAr`);
  English is for display only (`textEnUnofficial`). Texts we wrote ourselves start with
  `Summary:`. The optional `note` records where each language came from; it is not loaded.
- **The law is amended:** update the texts, set every entry's `lawVersion` and `LAW_VERSION` to
  the new version, and re-run the ingest. Rows of older versions stay in `law_articles`, so
  ratings made under them can still show their citations.

Rating aid, not legal advice. Several Arabic texts were rebuilt from PDFs that extracted
reversed, and a few come from secondary mirrors (see each entry's `note`); verify them against
the consolidated HRSD text before relying on them.
