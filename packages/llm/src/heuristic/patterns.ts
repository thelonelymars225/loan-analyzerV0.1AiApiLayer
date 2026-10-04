/*
 * Phrases several detectors share. All patterns run on normalised (lower-case) English.
 */

/** "basic salary", "base monthly wage", "basic pay". */
export const BASIC_WAGE =
  /\b(?:basic|base)\s+(?:monthly\s+)?(?:salary|wage|pay|remuneration)\b/;

/** "last actual wage", "total salary", "full wage", "salary plus all allowances". */
export const ACTUAL_WAGE =
  /\b(?:last\s+)?(?:actual|total|full|gross|entire|whole|complete)\s+(?:monthly\s+)?(?:salary|wage|pay|remuneration)\b|\blast\s+(?:monthly\s+)?(?:salary|wage|pay)\b|\b(?:salary|wage|pay)\s+(?:plus|and|including|inclusive of|together with|in addition to)\s+(?:all\s+)?(?:the\s+|its\s+|fixed\s+|regular\s+)*allowances\b/;

/** "in accordance with the Labor Law", "as per the law", "under the labour law". */
export const LAW_REFERENCE =
  /\b(?:in accordance with|according to|as per|pursuant to|under|subject to|as (?:provided|stipulated|set out|prescribed) (?:for )?(?:in|by))\s+(?:the\s+)?(?:provisions of\s+)?(?:the\s+)?(?:saudi\s+)?(?:labou?r\s+law|law|labou?r\s+regulations?)\b/;

/** Wording that places an obligation after the contract ends. */
export const AFTER_CONTRACT_ENDS = new RegExp(
  [
    // One optional word before the noun: "after the end of the work contract".
    String.raw`\bafter (?:the )?(?:end|expiry|expiration|termination|conclusion|completion) of (?:the |this |his |her |their )?(?:[\w'-]+ )?(?:contract|employment|agreement|service|relationship)\b`,
    String.raw`\bafter (?:the |this |his |her )?(?:contract|employment|agreement|service|relationship) (?:ends|has ended|ended|is terminated|terminates|expires|is over|comes to an end)\b`,
    String.raw`\bafter (?:leaving|termination|separation|resignation|resigning|the employee leaves)\b`,
    String.raw`\bfollowing (?:the )?(?:end|termination|expiry|expiration|conclusion|separation|resignation)\b`,
    String.raw`\bpost[- ](?:employment|termination|contract)\b`,
    String.raw`\bupon (?:leaving|termination|separation)\b`,
    String.raw`\bonce (?:the )?(?:contract|employment) (?:ends|is terminated|expires)\b`,
    String.raw`\b(?:during (?:and|or)|both during and|and|or|even) after (?:the )?(?:employment|contract|service|termination)\b`,
    String.raw`\bafter employment\b`,
  ].join("|"),
);

/** The worker's own agreement, e.g. "with the employee's written consent". */
export const WORKER_CONSENT = new RegExp(
  [
    String.raw`\b(?:with|subject to|upon|after obtaining) (?:the )?(?:prior )?(?:written )?(?:consent|agreement|approval) of the (?:employee|worker)\b`,
    String.raw`\b(?:with|subject to|upon) (?:the )?(?:employee'?s?|worker'?s?|his|her|their) (?:prior )?(?:written )?(?:consent|agreement|approval)\b`,
    String.raw`\bif the (?:employee|worker) (?:agrees|consents|chooses|requests|so wishes|opts)\b`,
    String.raw`\bat the (?:employee'?s?|worker'?s?) (?:option|request|choice|election)\b`,
    String.raw`\bas agreed (?:with|by) the (?:employee|worker)\b`,
  ].join("|"),
);

/** Cities and regions of Saudi Arabia, for "limited in place" checks. */
export const SAUDI_PLACE =
  /\b(?:in|within|inside)\s+(?:the\s+)?(?:city of\s+|region of\s+|province of\s+)?(?:riyadh|jeddah|jiddah|dammam|khobar|al[- ]khobar|dhahran|makkah|mecca|madinah|medina|taif|tabuk|abha|buraidah|buraydah|hail|ha'il|jubail|yanbu|najran|jazan|jizan|qassim|al[- ]qassim|al[- ]ahsa|hofuf|khamis mushait|neom|eastern province|western region|central region|northern region|southern region)\b|\bwithin (?:a |an )?(?:radius of )?\d+\s?(?:km|kilomet(?:er|re)s?)\b|\bwithin (?:the )?(?:same )?(?:city|region|province|governorate)\b/;
