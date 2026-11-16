"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LazyMotion, MotionConfig } from "motion/react";
import type { BasketLine, ShopProduct, ShopVariant } from "./model";
import { basketAmounts } from "@/commerce/bundles";

const storageKey = "mikaela.cart.v1";
const zoneKey = "mikaela.zone.v1";
const loadMotionFeatures = () =>
  import("./motion-features").then((module) => module.default);
function restore(value: string | null): BasketLine[] {
  try {
    const lines: unknown = JSON.parse(value || "[]");
    if (!Array.isArray(lines)) return [];
    return lines.filter(
      (l): l is BasketLine =>
        l &&
        typeof l.variantId === "string" &&
        typeof l.title === "string" &&
        typeof l.productSlug === "string" &&
        (l.unit === "piece" || l.unit === "kg") &&
        Number.isFinite(l.quantity) &&
        l.quantity > 0 &&
        Number.isFinite(l.price) &&
        l.price >= 0 &&
        Number.isFinite(l.step) &&
        l.step > 0 &&
        (l.requestedVariant == null || typeof l.requestedVariant === "string"),
    );
  } catch {
    return [];
  }
}
function useBasketState() {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [zone, setZone] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try {
      setLines(restore(localStorage.getItem(storageKey)));
      setZone(localStorage.getItem(zoneKey) || "");
    } catch {
      /* Пазаруването остава достъпно с ограничено хранилище в браузъра. */
    } finally {
      setReady(true);
    }
    const sync = (e: StorageEvent) => {
      if (e.key === storageKey) setLines(restore(e.newValue));
      if (e.key === zoneKey) setZone(e.newValue || "");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(lines));
      } catch {}
    }
  }, [ready, lines]);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(zoneKey, zone);
      } catch {}
    }
  }, [ready, zone]);
  const adjust = useCallback((id: string, value: number) => {
    setLines((previous) =>
      previous.flatMap((l) => {
        if (l.variantId !== id) return [l];
        const qty =
          Math.round(Math.min(l.max ?? Infinity, Math.max(0, value)) * 1000) /
          1000;
        return qty > 0 ? [{ ...l, quantity: qty }] : [];
      }),
    );
  }, []);
  const add = (product: Pick<ShopProduct, "slug" | "name" | "images">, v: ShopVariant) => {
    if (!v.available || v.price == null) return;
    const price = v.price;
    setLines((previous) => {
      const existing = previous.find((l) => l.variantId === v.id);
      if (existing)
        return previous.map((l) =>
          l.variantId === v.id
            ? {
                ...l,
                quantity: Math.min(
                  v.max ?? Infinity,
                  Math.round((l.quantity + v.step) * 1000) / 1000,
                ),
              }
            : l,
        );
      return [
        ...previous,
        {
          variantId: v.id,
          productSlug: product.slug,
          title: product.name,
          variantName: v.name,
          requiresVariantChoice: v.requiresVariantChoice,
          localBrochureOrder: v.localBrochureOrder,
          pack: v.pack,
          unit: v.unit,
          step: v.step,
          quantity: v.step,
          price,
          regular: v.regular,
          max: v.max,
          image: product.images[0],
          offer: v.offer,
          substitution: "skip",
          note: "",
        },
      ];
    });
    setNotice(product.name + " е добавен в количката.");
  };
  const edit = (
    id: string,
    patch: Partial<Pick<BasketLine, "substitution" | "note" | "requestedVariant">>,
  ) =>
    setLines((previous) =>
      previous.map((l) => (l.variantId === id ? { ...l, ...patch } : l)),
    );
  const clear = () => setLines([]);
  const lineTotals = useMemo(() => {
    const pricing = lines.map(line => ({
      variantId: line.variantId, quantity: line.quantity, unitCents: line.price, regularCents: line.regular,
      offer: line.offer ? {...line.offer, buy:line.offer.buy ?? 1, pay:line.offer.pay ?? 1} : null,
    }));
    // A restored basket can contain different revisions of a mixed offer.
    // The delivery quote resolves those conditions with current server data.
    let amounts: number[];
    try { amounts=basketAmounts(pricing); }
    catch { amounts=lines.map(line => Math.round(line.price*line.quantity)); }
    return Object.fromEntries(lines.map((line,i) => [line.variantId,amounts[i]]));
  }, [lines]);
  const total = Object.values(lineTotals).reduce((sum, part)=>sum+part,0);
  const count = lines.reduce(
    (n, l) => n + (l.unit === "kg" ? 1 : l.quantity),
    0,
  );
  return {
    lines,
    ready,
    notice,
    total,
    lineTotals,
    count,
    add,
    edit,
    adjust,
    clear,
    zone,
    setZone,
  };
}
const Basket = createContext<ReturnType<typeof useBasketState> | null>(null);
export function ShopProvider({ children }: { children: React.ReactNode }) {
  const basket = useBasketState();
  return (
    <Basket.Provider value={basket}>
      <LazyMotion features={loadMotionFeatures}>
        <MotionConfig reducedMotion="user">
          {children}
          <div className="sr-only" aria-live="polite" role="status">
            {basket.notice}
          </div>
        </MotionConfig>
      </LazyMotion>
    </Basket.Provider>
  );
}
export function useBasket() {
  const ctx = useContext(Basket);
  if (!ctx) throw new Error("Липсва контекст на количката.");
  return ctx;
}
