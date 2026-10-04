import { EMBEDDING_DIM } from "@rater/contracts";
import { COMMON_DOMAIN_WORDS, tokenize } from "./text";

/** Turns text into a fixed-size vector. Implementations must be deterministic. */
export interface Embedder {
  readonly dim: number;
  embed(text: string): number[];
}

/**
 * Character n-grams make the embedder forgiving of inflection ("terminate" / "termination",
 * Arabic prefixes and suffixes the tokenizer does not strip). They weigh less than whole
 * words so an exact word match still dominates.
 */
const NGRAM_SIZE = 3;
const WORD_WEIGHT = 1;
const COMMON_WORD_WEIGHT = 0.25;
const NGRAM_WEIGHT = 0.4;

/** 32-bit FNV-1a over UTF-16 code units: tiny, fast and stable across runs and machines. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function charNgrams(word: string): string[] {
  const padded = `<${word}>`;
  if (padded.length <= NGRAM_SIZE) return [padded];
  const grams: string[] = [];
  for (let i = 0; i + NGRAM_SIZE <= padded.length; i++) {
    grams.push(padded.slice(i, i + NGRAM_SIZE));
  }
  return grams;
}

/** Feature name → summed weight. Names are namespaced so a word never collides with an n-gram. */
function features(text: string): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (name: string, weight: number) =>
    weights.set(name, (weights.get(name) ?? 0) + weight);
  for (const word of tokenize(text)) {
    if (COMMON_DOMAIN_WORDS.has(word)) {
      add(`w:${word}`, COMMON_WORD_WEIGHT);
      continue;
    }
    add(`w:${word}`, WORD_WEIGHT);
    for (const gram of charNgrams(word)) add(`c:${gram}`, NGRAM_WEIGHT);
  }
  return weights;
}

/** Scales a vector to unit length in place. A zero vector stays zero. */
export function l2Normalise(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm;
  return vector;
}

/**
 * Local, offline embedder: feature hashing of normalised words and character trigrams into
 * EMBEDDING_DIM buckets, with a hash-derived sign to cancel out collisions on average.
 * Repeated features are damped (1 + log count) so long articles don't drown short queries.
 * Output is L2-normalised, so cosine similarity is a plain dot product.
 */
export class HashEmbedder implements Embedder {
  readonly dim: number;

  constructor(dim: number = EMBEDDING_DIM) {
    this.dim = dim;
  }

  embed(text: string): number[] {
    const vector = new Array<number>(this.dim).fill(0);
    for (const [name, weight] of features(text)) {
      const hash = fnv1a(name);
      const bucket = hash % this.dim;
      const sign = hash >>> 31 === 1 ? -1 : 1;
      const damped = weight <= 1 ? weight : 1 + Math.log(weight);
      vector[bucket] = vector[bucket]! + sign * damped;
    }
    return l2Normalise(vector);
  }
}

/** Cosine similarity of two L2-normalised vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * (b[i] ?? 0);
  return dot;
}
