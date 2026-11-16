import { BreakfastSelection } from "./breakfast-selection";
import type { ShopProduct } from "./model";
import "./breakfast.css";

const breakfastItems = [
  { pattern: /пълнозърнест хляб/iu, label: "Пълнозърнест хляб" },
  { pattern: /краве масло/iu, label: "Краве масло" },
  { pattern: /краве мляко.*UHT/iu, label: "Прясно мляко" },
];

export function BreakfastShelf({ products }: { products: ShopProduct[] }) {
  const picks = breakfastItems.flatMap(({ pattern, label }) => {
    const product = products.find((p) => pattern.test(p.name));
    const variant = product?.variants.find((v) => v.available && v.unit === "piece" && v.price != null && !v.restricted);
    return product && variant ? [{ label, product, variant }] : [];
  });
  if (picks.length < 2) return null;
  return (
    <section className="breakfast-feature" aria-labelledby="breakfast-title">
      <div className="breakfast-photo">
        <img src="/design/breakfast-table.webp" width={1040} height={693} loading="lazy"
          alt="Ръце разчупват хляб на маса с краве масло и кана прясно мляко." />
      </div>
      <div className="breakfast-recipe">
        <h2 id="breakfast-title">Закуска <em>заедно.</em></h2>
        <BreakfastSelection picks={picks} />
      </div>
    </section>
  );
}
