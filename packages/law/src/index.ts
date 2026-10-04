export { RULESET_VERSION, LAW_VERSION } from "./versions";
export { loadRules, loadCorpus, CorpusEntry } from "./load";
export { normaliseText, tokenize } from "./text";
export { HashEmbedder, cosineSimilarity, l2Normalise, type Embedder } from "./embedder";
export { MemoryArticleLookup, matchesRef, embedArticle } from "./lookup";
export { lawArticleRowId, toLawArticleRow, type LawArticleRow } from "./rows";
// ingest.ts is a CLI that needs @rater/db; it is deliberately not re-exported here.
