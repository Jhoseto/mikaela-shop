import { requireStaff } from "@/auth/access";
import { liveStats } from "@/admin/live";
import { errorResponse } from "@/admin/http";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    await requireStaff(["staff"]);
    if (!req.headers.get("accept")?.includes("text/event-stream"))
      return Response.json(await liveStats(), {
        headers: { "cache-control": "private,no-store" },
      });
    let timer: ReturnType<typeof setInterval> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    const clear = () => {
      ended = true;
      clearInterval(timer);
      clearTimeout(closing);
    };
    const stream = new ReadableStream({
      start(controller) {
        const close = () => {
          if (ended) return;
          clear();
          controller.close();
        };
        req.signal.addEventListener("abort", close, { once: true });
        const push = async () => {
          try {
            const stats = await liveStats();
            if (!ended)
              controller.enqueue(
                new TextEncoder().encode(
                  "data: " + JSON.stringify(stats) + "\n\n",
                ),
              );
          } catch {
            close();
          }
        };
        void push();
        timer = setInterval(() => void push(), 5500);
        closing = setTimeout(close, 45000);
      },
      cancel: clear,
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "private,no-store",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
