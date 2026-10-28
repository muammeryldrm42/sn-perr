import { dbSource, getSql } from "@/lib/db";
import type { CallRec } from "@/lib/book";
import { sanePeak, withinCap } from "@/lib/book";
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
  if (value === "runner" || value === "graduated" || value === "boosted" || value === "fresh" || value === "reclaim" || value === "ultra") return value;
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
    peakMcap: sanePeak(Number(row.call_mcap), Number(row.now_mcap), Number(row.peak_mcap), 0, Number(row.liq)),
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

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await run(item);
    }
  });
  await Promise.all(workers);
}

/** Persist calls only when a real Postgres URL is configured. Otherwise the browser keeps its own book. */
export async function syncSharedBook(tokens: Scored[]): Promise<{ shared: boolean; book: CallRec[] }> {
  if (dbSource !== "neon") return { shared: false, book: [] };
  try {
    const sql = await getSql();
    const now = Date.now();
    const prior = await sql<{ mint: string; called_at: number; path: string }>`
      select mint, called_at, path from calls order by called_at desc limit 400
    `;
    const known = new Map(prior.map((row) => [row.mint, row]));
    await eachLimited(tokens.filter((token) => token.mcap > 0), 8, async (token) => {
      if (token.called && token.path) {
        if (!known.has(token.mint)) {
          const taken = [...known.values()].map((row) => ({ calledAt: Number(row.called_at), path: asPath(row.path) }));
          if (!withinCap(token.path, taken, now)) return;
          known.set(token.mint, { mint: token.mint, called_at: now, path: token.path });
        }
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
            now_mcap = case
              when excluded.now_mcap <= greatest(calls.now_mcap, calls.call_mcap) * 40
                and (excluded.liq < 500 or excluded.now_mcap <= excluded.liq * 60)
              then excluded.now_mcap
              else calls.now_mcap
            end,
            peak_mcap = case
              when excluded.now_mcap <= greatest(calls.now_mcap, calls.call_mcap) * 40
                and (excluded.liq < 500 or excluded.now_mcap <= excluded.liq * 60)
              then greatest(calls.peak_mcap, excluded.now_mcap)
              else least(calls.peak_mcap, greatest(calls.now_mcap, calls.call_mcap))
            end,
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
            now_mcap = case
              when ${token.mcap} <= greatest(now_mcap, call_mcap) * 40
                and (${token.liq} < 500 or ${token.mcap} <= ${token.liq} * 60)
              then ${token.mcap}
              else now_mcap
            end,
            peak_mcap = case
              when ${token.mcap} <= greatest(now_mcap, call_mcap) * 40
                and (${token.liq} < 500 or ${token.mcap} <= ${token.liq} * 60)
              then greatest(peak_mcap, ${token.mcap})
              else least(peak_mcap, greatest(now_mcap, call_mcap))
            end,
            chg_h1 = ${token.chgH1},
            liq = ${token.liq},
            image = coalesce(${token.image ?? null}, image),
            symbol = ${token.symbol},
            name = ${token.name}
          where mint = ${token.mint}
        `;
      }
    });
    const seen = new Set(tokens.map((token) => token.mint));
    const open = await sql<{ mint: string }>`select mint from calls order by called_at desc limit 60`;
    const missing = open.map((row) => row.mint).filter((mint) => !seen.has(mint));
    if (missing.length) {
      const { quotesFor } = await import("./scan-core");
      const quotes = await quotesFor(missing);
      await eachLimited(
        quotes.filter((quote) => quote.mcap > 0),
        8,
        async (quote) => {
          await sql`
          update calls set
            now_mcap = case
              when ${quote.mcap} <= greatest(now_mcap, call_mcap) * 40
                and (${quote.liq} < 500 or ${quote.mcap} <= ${quote.liq} * 60)
              then ${quote.mcap}
              else now_mcap
            end,
            peak_mcap = case
              when ${quote.mcap} <= greatest(now_mcap, call_mcap) * 40
                and (${quote.liq} < 500 or ${quote.mcap} <= ${quote.liq} * 60)
              then greatest(peak_mcap, ${quote.mcap})
              else least(peak_mcap, greatest(now_mcap, call_mcap))
            end,
            chg_h1 = ${quote.chgH1},
            liq = ${quote.liq}
          where mint = ${quote.mint}
        `;
        },
      );
    }
    await sql`
      update calls
      set
        now_mcap = case when liq > 500 and now_mcap > liq * 60 then call_mcap else now_mcap end,
        peak_mcap = greatest(
          call_mcap,
          case when liq > 500 and now_mcap > liq * 60 then call_mcap else least(peak_mcap, greatest(now_mcap, call_mcap)) end
        )
      where now_mcap > 0
        and (
          peak_mcap > greatest(now_mcap, call_mcap) * 40
          or (liq > 500 and (peak_mcap > liq * 60 or now_mcap > liq * 60))
        )
    `;
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
