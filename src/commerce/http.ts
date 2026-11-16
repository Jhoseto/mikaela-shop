import { ZodError } from "zod";
import { ShopError } from "./checkout";
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
export async function body(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL || request.url).origin)
    throw new ShopError("Непозволен произход на заявката.", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ShopError("Очаква се JSON.", 415);
  if (Number(request.headers.get("content-length")) > 100000)
    throw new ShopError("Прекалено голяма заявка.", 413);
  const raw = await request.text();
  if (raw.length > 100000) throw new ShopError("Прекалено голяма заявка.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ShopError("Невалидна заявка.");
  }
}
export async function endpoint(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof ShopError)
      return json({ error: e.message, ...e.extra }, e.status);
    if (e instanceof ZodError)
      return json(
        {
          error: "Проверете въведените данни.",
          fields: e.issues.map((i) => i.path.join(".")),
        },
        400,
      );
    console.error(
      "commerce-request-failed",
      e instanceof Error ? e.name : "error",
    );
    return json(
      { error: "Временно не успяхме да обработим заявката. Опитайте отново." },
      500,
    );
  }
}
