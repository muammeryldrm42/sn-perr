import { createFileRoute } from "@tanstack/react-router";
import { runPulse } from "@/lib/market-fns";

export const Route = createFileRoute("/api/pulse")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await runPulse());
        } catch (error) {
          const message = error instanceof Error ? error.message : "pulse failed";
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
