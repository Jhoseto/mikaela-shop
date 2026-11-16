import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { shopPage, shopSettings } from "@/ui/shop/data";
import { infoPages } from "@/ui/shop/model";
import { AreaChooser } from "@/ui/shop/shell";
import { FindOrder } from "@/ui/shop/tracking";
type Params = Promise<{ slug: string }>;
const infoTitle = (slug: string) =>
  Object.prototype.hasOwnProperty.call(infoPages, slug)
    ? infoPages[slug as keyof typeof infoPages]
    : undefined;
export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  return { title: (await shopPage(slug))?.title || infoTitle(slug) };
}
export default async function InfoPage({ params }: { params: Params }) {
  const { slug } = await params,
    [p, s] = await Promise.all([shopPage(slug), shopSettings()]);
  const title = p?.title || infoTitle(slug);
  if (!title) notFound();
  return (
    <div className="shop-width inner-page">
      <nav className="breadcrumbs">
        <Link href="/">Начало</Link>
        <ChevronRight />
        {title}
      </nav>
      <div className="page-title">
        <h1>{title}</h1>
      </div>
      <article className="info-article surface">
        {p?.image && (
          <img className="shop-photo mb-5" src={p.image} alt={title} />
        )}
        {p?.body && <div className="cms-body">{p.body}</div>}
        {slug === "dostavka" && (
          <>
            <h2>Провери района си</h2>
            <AreaChooser />
            <h2>Плащане при доставка</h2>
            <p>
              Можеш да платиш в брой при получаване.
              {s.card &&
                " Магазинът приема и плащане с карта на мобилен ПОС при доставката."}
            </p>
          </>
        )}
        {(slug === "kontakti" || slug === "za-magazina") && (
          <>
            {s.shopPhoto && s.shopPhoto !== p?.image && (
              <img
                className="shop-photo"
                src={s.shopPhoto}
                alt="Моят Магазин Микаела"
              />
            )}
            <dl className="contact-list">
              {s.company && (
                <div>
                  <dt>Търговец</dt>
                  <dd>{s.company}</dd>
                </div>
              )}
              {s.companyId && (
                <div>
                  <dt>ЕИК</dt>
                  <dd>{s.companyId}</dd>
                </div>
              )}
              {s.address && (
                <div>
                  <dt>Адрес</dt>
                  <dd>{s.address}</dd>
                </div>
              )}
              {s.hours && (
                <div>
                  <dt>Работно време</dt>
                  <dd>{s.hours}</dd>
                </div>
              )}
              {s.phone && (
                <div>
                  <dt>Телефон</dt>
                  <dd>
                    <a href={"tel:" + s.phone}>{s.phone}</a>
                  </dd>
                </div>
              )}
              {s.email && (
                <div>
                  <dt>Имейл</dt>
                  <dd>
                    <a href={"mailto:" + s.email}>{s.email}</a>
                  </dd>
                </div>
              )}
              {slug === "kontakti" && (
                <div>
                  <dt>Facebook</dt>
                  <dd>
                    <a
                      href="https://www.facebook.com/profile.php?id=61584825427337"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Страницата на Микаела
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {!p?.body && !s.address && !s.email && !s.phone && !s.shopPhoto && (
              <p>Магазинът подготвя информацията за тази страница.</p>
            )}
          </>
        )}
        {slug === "otkaz-i-reklamacii" && (
          <>
            <h2>Откажете се от договора тук</h2>
            <p>
              За стоки с приложимо право на отказ отвори защитената поръчка. В
              същия екран можеш да подадеш рекламация по конкретен артикул.
            </p>
            <FindOrder />
          </>
        )}
        {!p?.body && ["obshti-usloviya", "poveritelnost"].includes(slug) && (
          <p>Магазинът все още не е публикувал текста на тази страница.</p>
        )}
      </article>
    </div>
  );
}
