import { createServerFn } from "@tanstack/react-start";
import type { ScanResult } from "@/lib/gate";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type ReadyScan = ScanResult;

let hot: { at: number; value: ReadyScan } | null = null;
let pending: Promise<ReadyScan> | null = null;

async function loadScan(): Promise<ReadyScan> {
  const { buildScan } = await import("./scan-core");
  const { syncSharedBook } = await import("./archive-db");
  try {
    const scan = await buildScan();
    const called = scan.tokens.filter((token) => token.called).slice(0, 2);
    if (called.length) {
      const { readRisk } = await import("./risk");
      for (const token of called) {
        const risk = await readRisk(token.mint);
        if (risk.state !== "rug") continue;
        token.called = false;
        token.path = null;
        token.tier = null;
        token.blockers = ["RugCheck marked a danger", ...token.blockers];
      }
    }
    const shared = await syncSharedBook(scan.tokens);
    const value = { ...scan, book: shared.book, shared: shared.shared };
    if (value.tokens.length) hot = { at: Date.now(), value };
    else if (hot) return hot.value;
    return value;
  } catch {
    if (hot) return hot.value;
    throw new Error("scan failed");
  }
}

export async function runPulse(): Promise<{ ok: true; skipped: boolean; shared: boolean; tokens: number; calls: number }> {
  const { dbSource, getSql } = await import("./db");
  if (dbSource === "neon") {
    const sql = await getSql();
    await sql`create table if not exists pulse (id int primary key, last_at bigint not null)`;
    await sql`insert into pulse (id, last_at) values (1, 0) on conflict (id) do nothing`;
    const now = Date.now();
    const gap = 12 * 60 * 1000;
    const won = await sql<{ last_at: number }>`
      update pulse set last_at = ${now} where id = 1 and ${now} - last_at >= ${gap} returning last_at
    `;
    if (!won.length) return { ok: true, skipped: true, shared: true, tokens: 0, calls: 0 };
  }
  const value = await loadScan();
  return {
    ok: true,
    skipped: false,
    shared: value.shared,
    tokens: value.tokens.length,
    calls: value.tokens.filter((token) => token.called).length,
  };
}

export const scanMarket = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (hot && now - hot.at < 25_000) {
    if (now - hot.at > 10_000 && !pending) {
      pending = loadScan().finally(() => {
        pending = null;
      });
    }
    return hot.value;
  }
  if (pending) return pending;
  pending = loadScan().finally(() => {
    pending = null;
  });
  return pending;
});

export const searchMarket = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const q = typeof input === "object" && input && "q" in input ? String((input as { q: unknown }).q) : "";
    return { q: q.trim().slice(0, 48) };
  })
  .handler(async ({ data }) => {
    const { buildSearch } = await import("./scan-core");
    return buildSearch(data.q);
  });

export const loadRisk = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const mint = typeof input === "object" && input && "mint" in input ? String((input as { mint: unknown }).mint) : "";
    if (!MINT.test(mint)) throw new Error("Invalid mint");
    return { mint };
  })
  .handler(async ({ data }) => {
    const { readRisk } = await import("./risk");
    return readRisk(data.mint);
  });

export const loadCandles = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const mint = typeof input === "object" && input && "mint" in input ? String((input as { mint: unknown }).mint) : "";
    if (!MINT.test(mint)) throw new Error("Invalid mint");
    const raw = typeof input === "object" && input && "aggregate" in input ? Number((input as { aggregate: unknown }).aggregate) : 1;
    const pair = typeof input === "object" && input && "pair" in input ? String((input as { pair: unknown }).pair) : "";
    return { mint, aggregate: raw === 15 ? 15 : raw === 5 ? 5 : 1, pair: MINT.test(pair) ? pair : "" };
  })
  .handler(async ({ data }) => {
    const { buildCandles } = await import("./scan-core");
    return buildCandles(data.mint, data.aggregate, data.pair);
  });
