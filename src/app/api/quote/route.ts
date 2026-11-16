import { quote, cartSchema } from "@/commerce/checkout";
import { endpoint, body } from "@/commerce/http";
export async function POST(r: Request) {
  return endpoint(async () => quote(cartSchema.parse(await body(r))));
}
