import { guestAction, tracking } from "@/commerce/orders";
import { endpoint, body } from "@/commerce/http";
type Context = { params: Promise<{ token: string }> };
export async function GET(_: Request, c: Context) {
  return endpoint(async () => tracking((await c.params).token));
}
export async function POST(r: Request, c: Context) {
  return endpoint(async () =>
    guestAction((await c.params).token, await body(r)),
  );
}
