import { useEffect, useRef, useState } from "react";
import type { AutoscaleInfoProvider } from "lightweight-charts";
import type { Candle } from "@/lib/gate";
import { fmtUsd } from "@/lib/format";
import { loadCandles } from "@/lib/market-fns";

export function TokenChart({
  mint,
  priceUsd,
  mcap,
  callMcap,
  calledAt,
  onHigh,
}: {
  mint: string;
  priceUsd: number;
  mcap: number;
  callMcap?: number;
  calledAt?: number;
  onHigh?: (high: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onHighRef = useRef(onHigh);
  onHighRef.current = onHigh;
  const [span, setSpan] = useState<1 | 5>(1);
  const [status, setStatus] = useState<"loading" | "empty" | "ready">("loading");

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let dead = false;
    let remove = () => {};
    setStatus("loading");

    void (async () => {
      let rows: Candle[] = [];
      try {
        rows = await loadCandles({ data: { mint, aggregate: span } });
      } catch {
        rows = [];
      }
      if (dead || !host.current) return;
      if (rows.length < 2) {
        setStatus("empty");
        return;
      }

      const { CandlestickSeries, ColorType, createChart, createSeriesMarkers } = await import("lightweight-charts");
      if (dead || !host.current) return;

      const asMcap = priceUsd > 0 && mcap > 0;
      const scale = asMcap ? mcap / priceUsd : 1;
      const seen = new Set<number>();
      const bars: { time: number; open: number; high: number; low: number; close: number }[] = [];
      for (const candle of rows) {
        const time = Math.floor(candle.t / 1000);
        if (seen.has(time)) continue;
        seen.add(time);
        bars.push({
          time,
          open: candle.o * scale,
          high: candle.h * scale,
          low: candle.l * scale,
          close: candle.c * scale,
        });
      }
      bars.sort((a, b) => a.time - b.time);
      if (bars.length < 2) {
        setStatus("empty");
        return;
      }
      onHighRef.current?.(Math.max(...bars.map((bar) => bar.high)));

      const chart = createChart(host.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#8d95a3",
          fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          fontSize: 11,
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: "#1c212b" },
          horzLines: { color: "#1c212b" },
        },
        rightPriceScale: { borderColor: "#2a2e38" },
        timeScale: { borderColor: "#2a2e38", timeVisible: true, secondsVisible: false },
        crosshair: {
          vertLine: { color: "#5e6572", labelBackgroundColor: "#171a21" },
          horzLine: { color: "#5e6572", labelBackgroundColor: "#171a21" },
        },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#3ddc6a",
        downColor: "#ff6b84",
        borderUpColor: "#3ddc6a",
        borderDownColor: "#ff6b84",
        wickUpColor: "#3ddc6a",
        wickDownColor: "#ff6b84",
        priceFormat: {
          type: "custom",
          minMove: 1,
          formatter: (price: number) => fmtUsd(price),
        },
        autoscaleInfoProvider: ((base) => {
          const info = base();
          if (!info?.priceRange || !(callMcap && callMcap > 0)) return info;
          return {
            priceRange: {
              minValue: Math.min(info.priceRange.minValue, callMcap),
              maxValue: Math.max(info.priceRange.maxValue, callMcap),
            },
          };
        }) satisfies AutoscaleInfoProvider,
      });
      series.setData(bars.map((bar) => ({ ...bar, time: bar.time as never })));

      if (callMcap && callMcap > 0) {
        series.createPriceLine({
          price: callMcap,
          color: "#e0b738",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "Called",
        });
        let nearest = bars[0].time;
        if (calledAt && calledAt > 0) {
          const target = calledAt / 1000;
          let best = Infinity;
          for (const bar of bars) {
            const dist = Math.abs(bar.time - target);
            if (dist < best) {
              best = dist;
              nearest = bar.time;
            }
          }
          if (target < bars[0].time) nearest = bars[0].time;
        }
        createSeriesMarkers(series, [
          {
            time: nearest as never,
            position: "belowBar",
            color: "#e0b738",
            shape: "arrowUp",
            text: `Called ${fmtUsd(callMcap)}`,
          },
        ]);
      }

      chart.timeScale().fitContent();
      setStatus("ready");
      remove = () => chart.remove();
    })();

    return () => {
      dead = true;
      remove();
    };
  }, [mint, span, priceUsd, mcap, callMcap, calledAt]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {([1, 5] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSpan(item)}
            className={`h-8 rounded-full px-3 font-mono text-xs ${span === item ? "bg-row text-fg" : "text-dim"}`}
          >
            {item}m
          </button>
        ))}
        <p className="ml-auto font-mono text-[10px] tracking-widest text-dim uppercase">TradingView</p>
      </div>
      <div className="relative h-80">
        {status === "loading" && <div className="absolute inset-0 animate-pulse rounded-lg bg-row" />}
        {status === "empty" && (
          <div className="absolute inset-0 grid place-items-center rounded-lg border border-line bg-row px-4 text-center text-sm text-muted">
            Candles did not load. The pair link below still has the live chart.
          </div>
        )}
        <div ref={host} className={`h-full w-full ${status === "ready" ? "" : "invisible"}`} />
      </div>
    </div>
  );
}
