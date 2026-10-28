export type Proof = "runner" | "graduated" | "boosted" | "fresh" | "reclaim";
export type CallTier = "conservative" | "balanced" | "risky";

export interface MarketToken {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  dex: string;
  pairUrl: string;
  mcap: number;
  fdv: number;
  liq: number;
  priceUsd: number;
  volM5: number;
  volH1: number;
  volH24: number;
  chgM5: number;
  chgH1: number;
  chgH6: number;
  chgH24: number;
  buysM5: number;
  sellsM5: number;
  buysH1: number;
  sellsH1: number;
  createdAt: number;
  boosts: number;
  dexPaid: boolean;
  twitter?: string;
  website?: string;
  telegram?: string;
  description?: string;
}

export interface Check {
  label: string;
  ok: boolean;
}

export interface Scored extends MarketToken {
  score: number;
  called: boolean;
  path: Proof | null;
  tier: CallTier | null;
  reasons: string[];
  blockers: string[];
  checks: Check[];
}

export interface SourceStatus {
  id: string;
  label: string;
  ok: boolean;
  count: number;
}

export interface ScanResult {
  tokens: Scored[];
  solUsd: number | null;
  scannedAt: number;
  sources: SourceStatus[];
  error: string | null;
  shared: boolean;
  book: import("./book").CallRec[];
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export function scoreToken(t: MarketToken, now = Date.now()): Scored {
  const ageMin = t.createdAt > 0 ? (now - t.createdAt) / 60_000 : 9_999;
  const liqRatio = t.mcap > 0 ? t.liq / t.mcap : 0;
  const buyRatio = t.buysH1 / Math.max(1, t.sellsH1);
  const dumping = t.chgH1 <= -20 || (t.chgH6 <= -45 && t.chgH1 < 0);
  const rollingOver = t.chgM5 <= -8;
  const chased = (t.chgH1 >= 160 && t.chgM5 < 6) || (t.chgH24 >= 400 && t.chgH1 < 10 && t.chgM5 < 8);
  const sellHeavy = t.sellsH1 > t.buysH1 * 1.8 && t.buysH1 + t.sellsH1 > 24;
  const thin = t.liq < 3_000 || (t.mcap > 40_000 && liqRatio < 0.025);
  const sizeOk = t.mcap >= 5_000 && t.mcap <= 40_000_000;
  const m5Buys = t.buysM5 >= t.sellsM5;

  const fresh =
    ageMin >= 4 &&
    ageMin <= 70 &&
    t.mcap >= 12_000 &&
    t.mcap <= 80_000 &&
    t.chgM5 >= 8 &&
    m5Buys &&
    t.buysM5 + t.buysH1 > t.sellsM5 + t.sellsH1 &&
    t.liq >= 2_500 &&
    !rollingOver &&
    !chased;

  let path: Proof | null = null;
  if (fresh && !dumping && !sellHeavy && t.chgH1 > -8) path = "fresh";

  let plus = 0;
  let pen = 0;
  plus += Math.min(18, Math.max(0, t.chgH1) / 4);
  plus += Math.min(8, Math.max(0, t.chgM5) / 3);
  plus += Math.min(8, Math.max(0, t.chgH6) / 10);
  if (buyRatio > 1) plus += Math.min(10, (buyRatio - 1) * 8);
  plus += Math.min(8, Math.log10(Math.max(t.volH1, 1)) * 2.2);
  if (liqRatio >= 0.08) plus += 8;
  else if (liqRatio >= 0.04) plus += 4;
  if (t.boosts > 0) plus += Math.min(8, Math.log2(t.boosts + 1));
  if (t.dexPaid) plus += 4;
  plus += (t.twitter ? 2 : 0) + (t.website ? 1 : 0) + (t.telegram ? 1 : 0);
  if (ageMin >= 4 && ageMin <= 40) plus += 8;
  else if (ageMin > 60 * 12) pen += 8;
  if (t.mcap >= 12_000 && t.mcap <= 80_000) plus += 8;
  else if (t.mcap > 2_000_000) pen += 12;
  if (t.chgM5 >= 8 && m5Buys) plus += 6;
  if (dumping) pen += 28;
  if (rollingOver) pen += 18;
  if (chased) pen += 22;
  if (sellHeavy) pen += 16;
  if (thin) pen += 12;
  if (t.chgH1 > 280) pen += 6;
  if (!sizeOk) pen += 10;
  const score = Math.max(0, Math.min(100, Math.round(plus - pen)));

  const socials = (t.twitter ? 1 : 0) + (t.website ? 1 : 0) + (t.telegram ? 1 : 0);
  let tier: CallTier | null = null;
  if (path === "fresh") tier = "risky";
  else if (
    path &&
    liqRatio >= 0.06 &&
    ageMin >= 20 &&
    t.chgH1 <= 160 &&
    t.chgH1 >= -5 &&
    score >= 58 &&
    (socials >= 1 || t.boosts >= 10) &&
    buyRatio >= 1
  ) {
    tier = "conservative";
  } else if (path) tier = "balanced";

  const checks: Check[] = [
    { label: "Market cap between $5K and $40M", ok: sizeOk },
    { label: "Not dumping over the last hour", ok: !dumping },
    { label: "Last 5 minutes are not rolling over", ok: !rollingOver },
    { label: "Not chasing a move that already happened", ok: !chased },
    { label: "Buys are holding against sells", ok: !sellHeavy },
    { label: "Liquidity matches the size", ok: !thin },
    { label: "Volume is actually trading", ok: t.volH1 >= 3_000 || t.volM5 >= 800 },
  ];

  const reasons: string[] = [];
  if (path === "fresh") reasons.push("New launch, and the last minutes are already bidding");
  if (t.chgM5 >= 8) reasons.push(`Up ${Math.round(t.chgM5)}% in the last 5 minutes`);
  if (buyRatio >= 1.25) reasons.push("More buys than sells this hour");
  if (t.mcap >= 12_000 && t.mcap <= 80_000) reasons.push("Still small enough to have room");
  if (t.twitter) reasons.push("X account is linked on the pair");
  if (path && socials === 0) reasons.push("No socials on the pair — higher risk");

  const blockers: string[] = [];
  if (!path) {
    if (!sizeOk) blockers.push(t.mcap < 5_000 ? "Still under $5K" : "Already too large for a call");
    if (dumping) blockers.push("Price is dumping");
    if (rollingOver) blockers.push("Selling off over the last 5 minutes");
    if (chased) blockers.push("The move already happened");
    if (sellHeavy) blockers.push("Sells are overwhelming buys");
    if (thin) blockers.push("Liquidity is too thin");
    if (ageMin > 70) blockers.push("Not a new launch");
    if (blockers.length === 0) blockers.push("Too new to prove a bid, or it never left the open");
  }

  return { ...t, score, called: path !== null, path, tier, reasons, blockers, checks };
}

export function paperTrade(callMcap: number, peakMcap: number, nowMcap: number): { x: number; status: "open" | "cut" | "banked" } {
  if (!(callMcap > 0)) return { x: 1, status: "open" };
  const mult = nowMcap / callMcap;
  const peakX = Math.max(peakMcap, nowMcap) / callMcap;
  const cost = 0.975;
  if (peakX < 2 && mult <= 0.6) return { x: mult * cost, status: "cut" };
  if (peakX >= 2) {
    const trail = peakX * 0.65;
    const exited = mult <= trail;
    const rest = exited ? trail : mult;
    return { x: ((2 + rest) / 2) * cost, status: exited ? "banked" : "open" };
  }
  return { x: mult * cost, status: "open" };
}
