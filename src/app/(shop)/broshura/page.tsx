import Link from "next/link";
import { ArrowRight, BookOpen, ChevronRight, FileText } from "lucide-react";
import { shopBrochure } from "@/ui/shop/data";
import { shortDate } from "@/ui/shop/model";
export const metadata = { title: "Актуална брошура" };
export default async function BrochurePage() {
  const b = await shopBrochure();
  return (
    <div className="shop-width inner-page">
      <nav className="breadcrumbs">
        <Link href="/">Начало</Link>
        <ChevronRight />
        Брошура
      </nav>
      <div className="page-title">
        <h1>Актуална брошура</h1>
      </div>
      {b ? (
        <>
          <div className="brochure-sheet">
            <div>
              <BookOpen size={38} />
              <h2>
                {shortDate(b.starts)} – {shortDate(b.ends, true)}
              </h2>
              <div className="button-row">
                <a
                  className="shop-button"
                  href={b.pdf}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText size={17} /> Разгърни брошурата
                </a>
                <Link className="shop-outline" href="/promocii">
                  Разгледай продуктите <ArrowRight size={15} />
                </Link>
              </div>
            </div>
            {b.cover && (
              <img src={b.cover} alt="Корица на актуалната брошура" />
            )}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <BookOpen />
          <h2>Няма актуална брошура</h2>
          <Link className="text-link" href="/produkti">
            Разгледай каталога <ArrowRight size={17} />
          </Link>
        </div>
      )}
    </div>
  );
}
