import { NextResponse } from "next/server";
export class InputIssue extends Error {}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configured = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : null;
  if (
    !origin ||
    (origin !== new URL(request.url).origin && origin !== configured)
  ) {
    throw new InputIssue("Невалидна заявка. Презареди страницата.");
  }
}
export async function limitedBody(request: Request, limit: number) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit)
    throw new InputIssue("Файлът или формулярът е прекалено голям.");
  const reader = request.body?.getReader();
  if (!reader) throw new InputIssue("Липсват данни.");
  const chunks: Uint8Array[] = [];
  let len = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    len += result.value.byteLength;
    if (len > limit) {
      await reader.cancel();
      throw new InputIssue("Файлът или формулярът е прекалено голям.");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks);
}
export function errorResponse(err: unknown) {
  const e = err as {
    code?: string;
    digest?: string;
    message?: string;
    status?: number;
  };
  if (
    e?.digest?.startsWith("NEXT_REDIRECT") ||
    e?.status === 403 ||
    e?.status === 401 ||
    e?.message === "Нямате права за това действие."
  )
    return NextResponse.json(
      { error: "Тази операция изисква подходящ служебен достъп." },
      { status: 403 },
    );
  if (e?.code === "23505")
    return NextResponse.json(
      { error: "Вече има запис със същите данни." },
      { status: 409 },
    );
  if (e?.code === "23503")
    return NextResponse.json(
      { error: "Свързаният запис липсва или все още се използва." },
      { status: 409 },
    );
  if (err instanceof InputIssue || (e?.message && /^[А-Яа-я]/.test(e.message)))
    return NextResponse.json(
      { error: e.message },
      {
        status: e.status && e.status >= 400 && e.status < 500 ? e.status : 400,
      },
    );
  console.error("admin_operation_failed", e?.code || "internal");
  return NextResponse.json(
    { error: "Промяната не беше записана. Опитай отново." },
    { status: 500 },
  );
}
