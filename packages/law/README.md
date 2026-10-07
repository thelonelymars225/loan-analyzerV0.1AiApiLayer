# @rater/law

The rules table, the law corpus, and the lookup the rating engine uses to cite articles.

| Path                   | What it is                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules/rules.json`     | The rules table (`RulesFile`). One entry per check. Code implements only the check function named by the rule ID.                                                 |
| `corpus/articles.json` | The law corpus (`LawArticle[]`): Labor Law articles (one entry per article, or per paragraph for long ones), Implementing Regulations, and Qiwa template clauses. |
| `src/load.ts`          | `loadRules()`, `loadCorpus()`: read and validate the JSON once per process.                                                                                       |
| `src/lookup.ts`        | `MemoryArticleLookup`: `byRefs()` finds the articles a rule references, in memory.                                                                                |

## Editing the data

- **A rule changes:** edit `rules/rules.json` and bump `RULESET_VERSION` (in `src/versions.ts`
  and the file) so cached clause analyses are redone. Every `articleRefs` entry must resolve to a
  corpus article, and every citation in `articles` must be backed by an `articleRefs` entry
  (the tests check both).
- **An article changes:** edit `corpus/articles.json`. Arabic is the official text (`textAr`);
  English is for display only (`textEnUnofficial`). Texts we wrote ourselves start with
  `Summary:`. The optional `note` records where each language came from; it is not loaded.
- **The law is amended:** update the texts, set every entry's `lawVersion` and `LAW_VERSION` to
  the new version. Findings store their citations, so ratings made under an older version
  still show them.

Rating aid, not legal advice. Several Arabic texts were rebuilt from PDFs that extracted
reversed, and a few come from secondary mirrors (see each entry's `note`); verify them against
the consolidated HRSD text before relying on them.
