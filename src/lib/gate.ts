export type Proof = "runner" | "graduated" | "boosted" | "fresh";
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

const PUMP_CURVE = new Set(["pumpfun"]);

export function scoreToken(t: MarketToken, now = Date.now()): Scored {
  const ageMin = t.createdAt > 0 ? (now - t.createdAt) / 60_000 : 9_999;
  const liqRatio = t.mcap > 0 ? t.liq / t.mcap : 0;
  const buyRatio = t.buysH1 / Math.max(1, t.sellsH1);
  const dumping = t.chgH1 <= -20 || (t.chgH6 <= -45 && t.chgH1 < 0);
  const sellHeavy = t.sellsH1 > t.buysH1 * 1.8 && t.buysH1 + t.sellsH1 > 24;
  const thin = t.liq < 3_000 || (t.mcap > 40_000 && liqRatio < 0.025);
  const sizeOk = t.mcap >= 5_000 && t.mcap <= 40_000_000;
  const health = !dumping && !sellHeavy && !thin && sizeOk;

  const fresh =
    ageMin >= 1 &&
    ageMin <= 90 &&
    t.mcap >= 4_000 &&
    t.mcap <= 180_000 &&
    (t.chgM5 >= 8 || t.chgH1 >= 18 || t.volM5 >= 2_000) &&
    t.buysM5 + t.buysH1 >= t.sellsM5 + t.sellsH1 &&
    t.liq >= 2_000;

  const runner =
    t.mcap >= 10_000 &&
    t.mcap <= 12_000_000 &&
    (t.chgH1 >= 18 || (t.chgH6 >= 35 && t.chgH1 > -8) || t.chgM5 >= 15) &&
    (t.volH1 >= 6_000 || t.volH24 >= 50_000) &&
    buyRatio >= 0.9 &&
    t.liq >= 6_000 &&
    liqRatio >= 0.03 &&
    t.chgH1 > -20;

  const graduated =
    !PUMP_CURVE.has(t.dex) &&
    ageMin <= 60 * 48 &&
    t.mcap >= 25_000 &&
    t.mcap <= 20_000_000 &&
    t.volH24 >= 30_000 &&
    (t.chgH1 >= 8 || t.chgH6 >= 20) &&
    buyRatio >= 0.85 &&
    t.liq >= 8_000 &&
    liqRatio >= 0.03 &&
    t.chgH1 > -15;

  const boosted =
    (t.boosts >= 20 || (t.dexPaid && t.boosts >= 8)) &&
    t.mcap >= 12_000 &&
    t.mcap <= 25_000_000 &&
    (t.volH1 >= 4_000 || t.volH24 >= 40_000) &&
    t.chgH1 > -12 &&
    buyRatio >= 0.75 &&
    t.liq >= 6_000;

  let path: Proof | null = null;
  if (health && runner) path = "runner";
  else if (health && graduated) path = "graduated";
  else if (health && boosted && !dumping && !sellHeavy && sizeOk && !thin) path = "boosted";
  else if (fresh && !dumping && !sellHeavy && t.chgH1 > -8) path = "fresh";

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
  if (ageMin >= 8 && ageMin <= 360) plus += 4;
  if (dumping) pen += 28;
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
    { label: "Buys are holding against sells", ok: !sellHeavy },
    { label: "Liquidity matches the size", ok: !thin },
    { label: "Volume is actually trading", ok: t.volH1 >= 3_000 || t.volM5 >= 800 },
  ];

  const reasons: string[] = [];
  if (path === "runner") reasons.push("Price is running and the volume is real");
  if (path === "graduated") reasons.push("Live on a pool, with size and buy pressure");
  if (path === "boosted") reasons.push("DexScreener profile or boosts, and it is still trading");
  if (path === "fresh") reasons.push("Launched in the last 90 minutes and already moving");
  if (buyRatio >= 1.25) reasons.push("More buys than sells this hour");
  if (t.chgH1 >= 12) reasons.push(`Up ${Math.round(t.chgH1)}% in the last hour`);
  if (liqRatio >= 0.08) reasons.push("Liquidity is thick for the market cap");
  if (t.boosts >= 20) reasons.push(`${t.boosts} active DexScreener boosts`);
  if (t.twitter) reasons.push("X account is linked on the pair");
  if (path && socials === 0) reasons.push("No socials on the pair — higher risk");

  const blockers: string[] = [];
  if (!path) {
    if (!sizeOk) blockers.push(t.mcap < 5_000 ? "Still under $5K" : "Already too large for a call");
    if (dumping) blockers.push("Price is dumping");
    if (sellHeavy) blockers.push("Sells are overwhelming buys");
    if (thin) blockers.push("Liquidity is too thin");
    if (blockers.length === 0) blockers.push("No proof yet — needs a run, a live pool, boosts, or a fresh move");
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
