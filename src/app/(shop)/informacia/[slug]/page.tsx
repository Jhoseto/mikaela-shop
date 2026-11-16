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
            {(s.localBrochureOrdering || s.demo) && <p>Пробните поръчки са без доставка и плащане.</p>}
            <h2>Район за доставка</h2>
            <AreaChooser />
            {!s.localBrochureOrdering && !s.demo && (
              <>
                <h2>Плащане при получаване</h2>
                <p>{s.card ? "В брой или с карта." : "В брой."}</p>
              </>
            )}
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
            {slug === "za-magazina" && !p?.body && (
              <p>Микаела е квартален хранителен магазин. <Link className="underline underline-offset-2" href="/broshura">Разгледай брошурата</Link> или <Link className="underline underline-offset-2" href="/informacia/kontakti">се свържи с нас</Link>.</p>
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
          </>
        )}
        {slug === "otkaz-i-reklamacii" && (
          <>
            <h2>Откажете се от договора тук</h2>
            <p>
              Отвори поръчката си, за да заявиш отказ или рекламация за артикул.
            </p>
            <FindOrder />
          </>
        )}
        {!p?.body && ["obshti-usloviya", "poveritelnost"].includes(slug) && (
          <Link className="text-link" href="/informacia/kontakti">
            {slug === "poveritelnost" ? "Свържи се с нас относно личните си данни" : "Свържи се с нас относно условията"}
          </Link>
        )}
      </article>
    </div>
  );
}
