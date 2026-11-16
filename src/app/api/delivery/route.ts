import { delivery } from "@/commerce/checkout";
import { endpoint } from "@/commerce/http";
export async function GET(r: Request) {
  return endpoint(() => delivery(new URL(r.url).searchParams.get("zone")));
}
