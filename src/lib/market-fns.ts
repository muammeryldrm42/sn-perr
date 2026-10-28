import { createServerFn } from "@tanstack/react-start";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const scanMarket = createServerFn({ method: "GET" }).handler(async () => {
  const { buildScan } = await import("./scan-core");
  const { syncSharedBook } = await import("./archive-db");
  const scan = await buildScan();
  const shared = await syncSharedBook(scan.tokens);
  return { ...scan, book: shared.book, shared: shared.shared };
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

export const loadCandles = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const mint = typeof input === "object" && input && "mint" in input ? String((input as { mint: unknown }).mint) : "";
    if (!MINT.test(mint)) throw new Error("Invalid mint");
    return { mint };
  })
  .handler(async ({ data }) => {
    const { buildCandles } = await import("./scan-core");
    return buildCandles(data.mint);
  });
