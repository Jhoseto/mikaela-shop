"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ShoppingBasket, Check } from "lucide-react";
import { useBasket } from "./basket";
import { ProductImage } from "./media";
import { money, type ShopProduct, type ShopVariant } from "./model";

type Pick = { label: string; product: ShopProduct; variant: ShopVariant };
export function BreakfastSelection({ picks }: { picks: Pick[] }) {
  const cart = useBasket();
  const [selected, setSelected] = useState(() => new Set(picks.map((pick) => pick.variant.id)));
  const [added, setAdded] = useState(false);
  const chosen = picks.filter((p) => selected.has(p.variant.id));
  function toggle(id: string) {
    setAdded(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="breakfast-selection">
      <fieldset>
        <legend className="sr-only">Продукти за закуска</legend>
        {picks.map(({ label, product, variant }) => (
          <label key={variant.id} className="breakfast-pick">
            <input type="checkbox" checked={selected.has(variant.id)} onChange={() => toggle(variant.id)} />
            <span className="pick-check" aria-hidden><Check size={13} strokeWidth={3} /></span>
            <span className="pick-thumb"><ProductImage src={product.images[0]} name="" small /></span>
            <span className="pick-name"><strong>{label}</strong><small>{[product.brand, variant.pack].filter(Boolean).join(" · ")}</small></span>
            <strong className="pick-price">{money(variant.price!)}</strong>
          </label>
        ))}
      </fieldset>
      <div className="breakfast-actions">
        {added ? (
          <Link className="shop-button" href="/kolichka"><Check size={17} /> Към количката <ArrowUpRight size={15} /></Link>
        ) : (
          <button type="button" className="shop-button" disabled={!cart.ready || !chosen.length}
            onClick={() => { chosen.forEach(({ product, variant }) => cart.add(product, variant)); setAdded(true); }}>
            <ShoppingBasket size={18} /> Добави избраните ({chosen.length})
          </button>
        )}
        {added && <span role="status">Добавени в количката</span>}
      </div>
    </div>
  );
}
