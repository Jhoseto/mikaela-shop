import { ShopProvider } from "@/ui/shop/basket";
import { Header, Footer } from "@/ui/shop/shell";
import { shopSettings } from "@/ui/shop/data";
export const dynamic = "force-dynamic";
export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await shopSettings();
  return (
    <div className="shop">
      <ShopProvider>
        <Header settings={settings} />
        <main id="main-shop" tabIndex={-1}>
          {children}
        </main>
        <Footer settings={settings} />
      </ShopProvider>
    </div>
  );
}
