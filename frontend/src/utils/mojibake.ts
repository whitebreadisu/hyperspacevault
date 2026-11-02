// UTF-8 text that was decoded as cp1252 somewhere upstream ("canâ€™t"). One
// card in the 2026-10-02 export carries it (TWI 15 General Grievous, design
// note §4 D2 / §8). The repair runs at render, in the app's card text and on
// the public card pages alike.

/** cp1252 bytes 0x80-0x9F (the five undefined slots map to themselves). */
const CP1252_HIGH: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** The census pattern from the design note (§8, R1). */
export const MOJIBAKE = /Ã|â€|Â|�/;

/** Repairs UTF-8 text that was decoded as cp1252 ("canâ€™t" -> "can’t",
 * "6Â or" -> "6 or"). Text without the census pattern, or text that does
 * not round-trip to valid UTF-8, is returned unchanged. */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE.test(text)) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x100) bytes.push(code);
    else if (CP1252_HIGH[ch] !== undefined) bytes.push(CP1252_HIGH[ch]);
    else return text;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

/** repairMojibake for an optional field. */
export function repairText<T extends string | null | undefined>(text: T): T {
  return (typeof text === "string" ? repairMojibake(text) : text) as T;
}
