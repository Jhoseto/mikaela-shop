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
    throw new ShopError("Презареди страницата на магазина и опитай отново.", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ShopError("Формулярът не може да се изпрати. Презареди страницата.", 415);
  if (Number(request.headers.get("content-length")) > 100000)
    throw new ShopError("Въведените данни са прекалено дълги.", 413);
  const raw = await request.text();
  if (raw.length > 100000) throw new ShopError("Въведените данни са прекалено дълги.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ShopError("Формулярът не може да се изпрати. Презареди страницата.");
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
          error: "Провери въведените данни.",
          fields: e.issues.map((i) => i.path.join(".")),
        },
        400,
      );
    console.error(
      "commerce-request-failed",
      e instanceof Error ? e.name : "error",
    );
    return json(
      { error: "Не успяхме да завършим действието. Опитай отново след малко." },
      500,
    );
  }
}
