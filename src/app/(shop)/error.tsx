"use client";
import Link from "next/link";
import { RefreshCcw } from "lucide-react";

export default function StoreError({ reset }: { reset: () => void }) {
  return (
    <div className="shop-width inner-page">
      <div className="empty-state">
        <h1>Страницата не се зареди</h1>
        <div className="button-row">
          <button type="button" className="shop-button" onClick={reset}>
            <RefreshCcw size={16} /> Опитай отново
          </button>
          <Link className="shop-outline" href="/">
            Към началото
          </Link>
        </div>
      </div>
    </div>
  );
}
