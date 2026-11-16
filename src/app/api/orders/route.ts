import { submit, orderSchema } from "@/commerce/checkout";
import { endpoint, body } from "@/commerce/http";
export async function POST(r: Request) {
  return endpoint(async () => submit(orderSchema.parse(await body(r))));
}
