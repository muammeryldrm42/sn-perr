import type { Proof } from "./gate";

export interface CallRec {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  dex: string;
  pairUrl: string;
  calledAt: number;
  callMcap: number;
  peakMcap: number;
  nowMcap: number;
  path: Proof;
  score: number;
  reasons: string[];
  twitter?: string;
  website?: string;
  telegram?: string;
  chgH1: number;
  liq: number;
  boosts: number;
}

export function sanePeak(callMcap: number, nowMcap: number, peakMcap: number, liveMcap = 0, liq = 0): number {
  const now = liveMcap > 0 ? liveMcap : nowMcap;
  let peak = Math.max(peakMcap, now, callMcap);
  const anchor = Math.max(now, callMcap);
  if (liq > 500 && peak > liq * 60) peak = anchor;
  if (anchor > 0 && peak > anchor * 40) peak = anchor;
  return peak;
}

export function nextPeak(callMcap: number, prevNow: number, prevPeak: number, nextMcap: number, liq = 0): number {
  if (!(nextMcap > 0)) return sanePeak(callMcap, prevNow, prevPeak, 0, liq);
  const anchor = Math.max(prevNow, callMcap);
  const spike = (anchor > 0 && nextMcap > anchor * 40) || (liq > 500 && nextMcap > liq * 60);
  const peak = spike ? prevPeak : Math.max(prevPeak, nextMcap);
  return sanePeak(callMcap, nextMcap, peak, nextMcap, liq);
}

const BOOK_KEY = "talons.book.v1";
const WATCH_KEY = "talons.watch.v1";
const NOTICE_KEY = "talons.notice.v1";
const SEEN_KEY = "talons.seen.v1";

export function loadSeen(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.localStorage.getItem(SEEN_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function saveSeen(at: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SEEN_KEY, String(at));
}

function isRec(value: unknown): value is CallRec {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CallRec>;
  return typeof row.mint === "string" && typeof row.callMcap === "number" && typeof row.symbol === "string" && typeof row.calledAt === "number";
}

export function loadBook(): CallRec[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BOOK_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRec) : [];
  } catch {
    return [];
  }
}

export function saveBook(rows: CallRec[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BOOK_KEY, JSON.stringify(rows.slice(0, 400)));
}

export function loadWatch(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCH_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function saveWatch(mints: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WATCH_KEY, JSON.stringify(mints.slice(0, 200)));
}

export function noticeDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NOTICE_KEY) === "1";
}

export function dismissNotice() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTICE_KEY, "1");
}

export function mergeBook(tokens: { mint: string; symbol: string; name: string; image?: string; dex: string; pairUrl: string; mcap: number; path: Proof | null; called: boolean; score: number; reasons: string[]; twitter?: string; website?: string; telegram?: string; chgH1: number; liq: number; boosts: number }[], prev: CallRec[], now: number): CallRec[] {
  const map = new Map(prev.map((row) => [row.mint, { ...row }]));
  for (const token of tokens) {
    const existing = map.get(token.mint);
    if (!token.called || !token.path) {
      if (existing) {
        if (token.mcap > 0) {
          const anchor = Math.max(existing.nowMcap, existing.callMcap);
          const spike = (anchor > 0 && token.mcap > anchor * 40) || (token.liq > 500 && token.mcap > token.liq * 60);
          existing.peakMcap = nextPeak(existing.callMcap, existing.nowMcap, existing.peakMcap, token.mcap, token.liq || existing.liq);
          if (!spike) existing.nowMcap = token.mcap;
        }
        existing.chgH1 = token.chgH1;
        existing.liq = token.liq || existing.liq;
        existing.image = token.image ?? existing.image;
      }
      continue;
    }
    if (!existing) {
      map.set(token.mint, {
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        image: token.image,
        dex: token.dex,
        pairUrl: token.pairUrl,
        calledAt: now,
        callMcap: token.mcap,
        peakMcap: token.mcap,
        nowMcap: token.mcap,
        path: token.path,
        score: token.score,
        reasons: token.reasons,
        twitter: token.twitter,
        website: token.website,
        telegram: token.telegram,
        chgH1: token.chgH1,
        liq: token.liq,
        boosts: token.boosts,
      });
    } else {
      const anchor = Math.max(existing.nowMcap, existing.callMcap);
      const spike = (anchor > 0 && token.mcap > anchor * 40) || ((token.liq || existing.liq) > 500 && token.mcap > (token.liq || existing.liq) * 60);
      existing.peakMcap = nextPeak(existing.callMcap, existing.nowMcap, existing.peakMcap, token.mcap, token.liq || existing.liq);
      if (!spike) existing.nowMcap = token.mcap;
      existing.score = token.score;
      existing.chgH1 = token.chgH1;
      existing.liq = token.liq;
      existing.image = token.image ?? existing.image;
      existing.symbol = token.symbol;
      existing.name = token.name;
    }
  }
  return [...map.values()].sort((a, b) => b.calledAt - a.calledAt).slice(0, 400);
}
