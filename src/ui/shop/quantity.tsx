"use client";
import { Minus, Plus } from "lucide-react";
import { m } from "motion/react";
import { useBasket } from "./basket";
import type { ShopProduct, ShopVariant } from "./model";
import { amount } from "./model";
export function Quantity({
  id,
  qty,
  step,
  max,
  unit,
  label,
  add,
}: {
  id: string;
  qty: number;
  step: number;
  max?: number;
  unit: string;
  label: string;
  add?: { run: () => void; label: string; disabled: boolean };
}) {
  const { adjust } = useBasket();
  const adding = qty === 0 && add;
  return (
    <div
      className={adding ? undefined : "quantity-picker"}
      role={adding ? undefined : "group"}
      aria-label={adding ? undefined : "Количество за " + label}
    >
      <button
        type="button"
        className={adding ? "add-button" : undefined}
        aria-label={(adding ? adding.label : "Намали") + " " + label}
        disabled={adding ? adding.disabled : false}
        onClick={adding ? adding.run : () => adjust(id, qty - step)}
      >
        {adding ? (
          <>
            <Plus size={17} />
            {adding.label}
          </>
        ) : (
          <Minus size={16} />
        )}
      </button>
      {!adding && (
        <>
          <m.output
            initial={{ scale: 0.96 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.16 }}
            aria-live="polite"
          >
            {amount(qty)}
            {unit === "kg" && " кг"}
          </m.output>
          <button
            type="button"
            disabled={max != null && qty + step > max}
            aria-label={"Увеличи " + label}
            onClick={() => adjust(id, qty + step)}
          >
            <Plus size={16} />
          </button>
        </>
      )}
    </div>
  );
}
export function AddControl({
  product,
  variant,
  large = false,
}: {
  product: ShopProduct;
  variant: ShopVariant;
  large?: boolean;
}) {
  const cart = useBasket();
  const line = cart.lines.find((l) => l.variantId === variant.id);
  const available = variant.available && variant.price != null;
  return (
    <div className={"add-wrap" + (large ? " large" : "")}>
      <Quantity
        id={variant.id}
        qty={line?.quantity ?? 0}
        step={line?.step ?? variant.step}
        max={line?.max ?? variant.max}
        unit={variant.unit}
        label={product.name}
        add={{
          run: () => cart.add(product, variant),
          label: available ? "Добави" : "Недостъпен",
          disabled: !available || !cart.ready,
        }}
      />
    </div>
  );
}
