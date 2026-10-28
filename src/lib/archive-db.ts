import { dbSource, getSql } from "@/lib/db";
import type { CallRec } from "@/lib/book";
import type { Proof, Scored } from "@/lib/gate";

interface CallRow {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  dex: string;
  pair_url: string;
  called_at: number;
  call_mcap: number;
  peak_mcap: number;
  now_mcap: number;
  path: string;
  score: number;
  reasons: string;
  twitter: string | null;
  website: string | null;
  telegram: string | null;
  chg_h1: number;
  liq: number;
  boosts: number;
}

function asPath(value: string): Proof {
  if (value === "runner" || value === "graduated" || value === "boosted" || value === "fresh" || value === "reclaim") return value;
  return "fresh";
}

function asReasons(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toRec(row: CallRow): CallRec {
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    image: row.image ?? undefined,
    dex: row.dex,
    pairUrl: row.pair_url,
    calledAt: Number(row.called_at),
    callMcap: Number(row.call_mcap),
    peakMcap: Number(row.peak_mcap),
    nowMcap: Number(row.now_mcap),
    path: asPath(row.path),
    score: Number(row.score),
    reasons: asReasons(row.reasons),
    twitter: row.twitter ?? undefined,
    website: row.website ?? undefined,
    telegram: row.telegram ?? undefined,
    chgH1: Number(row.chg_h1),
    liq: Number(row.liq),
    boosts: Number(row.boosts),
  };
}

/** Persist calls only when a real Postgres URL is configured. Otherwise the browser keeps its own book. */
export async function syncSharedBook(tokens: Scored[]): Promise<{ shared: boolean; book: CallRec[] }> {
  if (dbSource !== "neon") return { shared: false, book: [] };
  try {
    const sql = await getSql();
    const now = Date.now();
    for (const token of tokens) {
      if (!(token.mcap > 0)) continue;
      if (token.called && token.path) {
        await sql`
          insert into calls (
            mint, symbol, name, image, dex, pair_url, called_at, call_mcap, peak_mcap, now_mcap,
            path, score, reasons, twitter, website, telegram, chg_h1, liq, boosts
          ) values (
            ${token.mint}, ${token.symbol}, ${token.name}, ${token.image ?? null}, ${token.dex}, ${token.pairUrl},
            ${now}, ${token.mcap}, ${token.mcap}, ${token.mcap}, ${token.path}, ${token.score},
            ${JSON.stringify(token.reasons)}, ${token.twitter ?? null}, ${token.website ?? null}, ${token.telegram ?? null},
            ${token.chgH1}, ${token.liq}, ${token.boosts}
          )
          on conflict (mint) do update set
            symbol = excluded.symbol,
            name = excluded.name,
            image = coalesce(excluded.image, calls.image),
            dex = excluded.dex,
            pair_url = excluded.pair_url,
            now_mcap = excluded.now_mcap,
            peak_mcap = greatest(calls.peak_mcap, excluded.now_mcap),
            score = excluded.score,
            reasons = excluded.reasons,
            twitter = coalesce(excluded.twitter, calls.twitter),
            website = coalesce(excluded.website, calls.website),
            telegram = coalesce(excluded.telegram, calls.telegram),
            chg_h1 = excluded.chg_h1,
            liq = excluded.liq,
            boosts = excluded.boosts
        `;
      } else {
        await sql`
          update calls set
            now_mcap = ${token.mcap},
            peak_mcap = greatest(peak_mcap, ${token.mcap}),
            chg_h1 = ${token.chgH1},
            liq = ${token.liq},
            image = coalesce(${token.image ?? null}, image),
            symbol = ${token.symbol},
            name = ${token.name}
          where mint = ${token.mint}
        `;
      }
    }
    await sql`
      update calls
      set peak_mcap = greatest(call_mcap, now_mcap)
      where now_mcap > 0
        and peak_mcap > now_mcap * 80
        and peak_mcap > call_mcap * 30
    `;
    const known = new Set(tokens.map((token) => token.mint));
    const open = await sql<{ mint: string }>`select mint from calls order by called_at desc limit 60`;
    const missing = open.map((row) => row.mint).filter((mint) => !known.has(mint));
    if (missing.length) {
      const { quotesFor } = await import("./scan-core");
      const quotes = await quotesFor(missing);
      for (const quote of quotes) {
        if (!(quote.mcap > 0)) continue;
        await sql`
          update calls set
            now_mcap = ${quote.mcap},
            peak_mcap = greatest(peak_mcap, ${quote.mcap}),
            chg_h1 = ${quote.chgH1},
            liq = ${quote.liq}
          where mint = ${quote.mint}
        `;
      }
    }
    const rows = await sql<CallRow>`
      select mint, symbol, name, image, dex, pair_url, called_at, call_mcap, peak_mcap, now_mcap,
             path, score, reasons, twitter, website, telegram, chg_h1, liq, boosts
      from calls
      order by called_at desc
      limit 400
    `;
    return { shared: true, book: rows.map(toRec) };
  } catch (error) {
    console.error("[archive] shared book skipped", error instanceof Error ? error.message : "unknown");
    return { shared: false, book: [] };
  }
}
