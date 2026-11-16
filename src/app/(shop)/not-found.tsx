import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="shop-width inner-page">
      <div className="empty-state">
        <Search aria-hidden="true" />
        <h1>Страницата не е намерена</h1>
        <p>Провери адреса или потърси продукт в каталога.</p>
        <Link className="shop-button" href="/produkti">
          Към продуктите <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
