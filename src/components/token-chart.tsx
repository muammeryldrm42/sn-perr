import { fmtUsd } from "@/lib/format";

export function TokenChart({
  mint,
  callMcap,
}: {
  mint: string;
  priceUsd: number;
  mcap: number;
  callMcap?: number;
  calledAt?: number;
}) {
  const src =
    `https://www.geckoterminal.com/solana/tokens/${mint}` +
    "?embed=1&info=0&swaps=0&light_chart=0&chart_type=market_cap&resolution=15m&bg_color=0b0d12";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="font-mono text-[10px] tracking-widest text-dim uppercase">Market cap</p>
        {callMcap && callMcap > 0 ? (
          <p className="ml-auto font-mono text-xs text-gold">Called {fmtUsd(callMcap)}</p>
        ) : (
          <p className="ml-auto font-mono text-[10px] tracking-widest text-dim uppercase">TradingView</p>
        )}
      </div>
      <iframe
        title="Market cap chart"
        src={src}
        className="h-[28rem] w-full rounded-lg border-0 bg-bg"
        allow="clipboard-write; fullscreen"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
