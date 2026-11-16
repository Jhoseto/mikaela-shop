import { shopSettings } from "@/ui/shop/data";
import { OrderFlow } from "@/ui/shop/checkout";
export const metadata = {
  title: "Количка",
  robots: { index: false, follow: false },
};
export default async function CartPage() {
  return <OrderFlow settings={await shopSettings()} />;
}
