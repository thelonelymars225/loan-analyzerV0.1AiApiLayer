import { randomBytes } from "node:crypto";

/**
 * Row ids like "rt_01k9f3v8wq7m2c4x0d5e6g7h8j" (prefix, "_", then 26 lowercase characters).
 *
 * The first 10 characters encode the creation time in milliseconds and the last 16 are
 * random (80 bits), both in Crockford base32. The alphabet is in ASCII order, so ids of the
 * same prefix sort by creation time, which lets list endpoints page by id.
 *
 * Within one process, ids created in the same millisecond still sort in creation order:
 * the random part is incremented instead of drawn again (the ULID "monotonic" scheme).
 */

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const RANDOM_BYTES = 10; // 16 base32 characters = 80 bits = 10 bytes
const MAX_RANDOM = (1n << 80n) - 1n;
const PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;

let lastTime = -1;
let lastRandom = 0n;

export function newId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid id prefix "${prefix}": use lowercase letters and digits`);
  }
  const time = Date.now();
  const random = nextRandom(time);
  return `${prefix}_${encode(BigInt(time), TIME_LENGTH)}${encode(random, RANDOM_LENGTH)}`;
}

function nextRandom(time: number): bigint {
  if (time === lastTime && lastRandom < MAX_RANDOM) {
    lastRandom += 1n;
  } else {
    lastTime = time;
    lastRandom = BigInt(`0x${randomBytes(RANDOM_BYTES).toString("hex")}`);
  }
  return lastRandom;
}

/** Fixed-width base32: `length` characters, most significant first. */
function encode(value: bigint, length: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < length; i++) {
    out = ALPHABET.charAt(Number(rest % 32n)) + out;
    rest /= 32n;
  }
  return out;
}
