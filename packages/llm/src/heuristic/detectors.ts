import { detectProjectEnd } from "./contract-term";
import type { Detector } from "./detection";
import { detectArt77Compensation, detectEosBase, detectOvertimeRate } from "./pay";
import { detectConfidentiality, detectNonCompete, detectTransfer } from "./restrictions";
import {
  detectLeaveForfeiture,
  detectLeaveMinimum,
  detectProbation,
  detectWorkingHours,
} from "./working-time";

/**
 * One detector per rule ID the offline analyser understands. A candidate rule without a
 * detector here is simply never matched offline.
 */
export const CLAUSE_DETECTORS: ReadonlyMap<string, Detector> = new Map([
  ["PROB-MAX-01", detectProbation],
  ["LEAVE-MIN-01", detectLeaveMinimum],
  ["LEAVE-FORFEIT-01", detectLeaveForfeiture],
  ["HOURS-MAX-01", detectWorkingHours],
  ["OT-RATE-01", detectOvertimeRate],
  ["EOS-BASE-01", detectEosBase],
  ["COMP-ART77-01", detectArt77Compensation],
  ["TYPE-ART57-01", detectProjectEnd],
  ["TRANSFER-KSA-01", detectTransfer],
  ["NONCOMPETE-01", detectNonCompete],
  ["CONFIDENTIAL-01", detectConfidentiality],
]);
