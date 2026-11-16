import { shopSettings } from "@/ui/shop/data";
import { OrderFlow } from "@/ui/shop/checkout";
export const metadata = {
  title: "Завършване на поръчка",
  robots: { index: false, follow: false },
};
export default async function CheckoutPage() {
  return <OrderFlow checkout settings={await shopSettings()} />;
}
