# Wage check scenarios

Three fake HR environments for testing the on-prem wage check harness. They all hold the same 30 fake people and the same planted September problems, and only the mess differs:

1. `scenario-1-messy-not-synced`: the newest wage file and six contracts exist only on the desktop.
2. `scenario-2-messy-synced`: the same mess, with the desktop inside the synced cloud folder.
3. `scenario-3-organized`: tidy folders, monthly emails and an ERP export.

Each scenario has `desktop/`, `cloud/`, `mailbox/` (one `.eml` per message) and, in scenario 3, `erp/`, plus an `expected.json` answer key. The key lists every file worth collecting and what it is, the files to ignore, the records a perfect harness extracts for September, and what `checkWages` makes of them.

```sh
CHROME_PATH=/usr/bin/chromium pnpm --filter @rater/scenarios generate out
```

PDFs are printed by headless Chromium, which needs an Arabic font (for example Noto Naskh Arabic). Everything is synthetic: names, IDs and IBANs are made up.
