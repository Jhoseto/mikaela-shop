import Link from "next/link";
import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { PageHeading, Panel, Open, Empty } from "@/admin/presentation";
import { Field } from "@/admin/widgets";
import { ProductTable } from "@/admin/product-table";
import { priceNeedsReview } from "@/admin/price-check";
export default async function Products({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireStaff(["staff"]);
  const d = await searchParams;
  const page = Math.max(1, Math.min(10000, Number(d.page) || 1));
  const params = [
    String(d.q || "").slice(0, 150),
    d.category || "",
    d.origin || "",
    d.status || "",
    d.available || "",
  ];
  const where =
    `where ($1='' or p.name ilike '%'||$1||'%' or p.brand ilike '%'||$1||'%') and ($2='' or p.category_id::text=$2) and ($3='' or p.origin=$3) and ($4='' or p.status=$4) and ($5='' or p.available::text=$5)` +
    (d.issue === "price"
      ? ` and exists(select 1 from variants v where v.product_id=p.id and ${priceNeedsReview})`
      : "");
  const [rows, cats, count] = await Promise.all([
    query(
      `select p.*, c.name category,v.id variant,v.name variant_name,v.regular_cents from products p left join categories c on c.id=p.category_id left join lateral(select * from variants where product_id=p.id order by name,id limit 1)v on true ` +
        where +
        " order by p.updated_at desc,p.id limit 40 offset $6",
      [...params, (page - 1) * 40],
    ),
    query("select id,name from categories order by name"),
    query("select count(*) total from products p " + where, params),
  ]);
  const target = (n: number) =>
    "/admin/products?" +
    new URLSearchParams({ ...d, page: String(n) }).toString();
  return (
    <>
      <PageHeading
        title="Продукти"
        subtitle={count[0].total + " продукта в каталога"}
        action={<Open href="/admin/products/nov">Добави продукт</Open>}
      />
      <Panel>
        <form className="adm-filter">
          <Field title="Търсене">
            <input
              type="search"
              name="q"
              placeholder="Име или марка"
              defaultValue={d.q}
            />
          </Field>
          <Field title="Категория">
            <select name="category" defaultValue={d.category}>
              <option value="">Всички</option>
              {cats.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Произход">
            <select name="origin" defaultValue={d.origin}>
              <option value="">Всички</option>
              <option value="brochure">Брошура</option>
              <option value="local">От магазина</option>
            </select>
          </Field>
          <label className="adm-check">
            <input
              type="checkbox"
              name="issue"
              value="price"
              defaultChecked={d.issue === "price"}
            />
            За проверка на цената
          </label>
          <Field title="Публикуване">
            <select name="status" defaultValue={d.status}>
              <option value="">Всички</option>
              <option value="draft">Чернова</option>
              <option value="published">Публикуван</option>
              <option value="hidden">Скрит</option>
              <option value="archived">Архивиран</option>
            </select>
          </Field>
          <Field title="Наличност">
            <select name="available" defaultValue={d.available}>
              <option value="">Всички</option>
              <option value="true">Наличен</option>
              <option value="false">Изчерпан</option>
            </select>
          </Field>
          <button className="adm-btn">Търси</button>
        </form>
      </Panel>
      <Panel>
        {rows.length ? (
          <ProductTable rows={rows} />
        ) : (
          <Empty>Няма продукти по тези критерии.</Empty>
        )}
        <div className="adm-actions">
          {page > 1 && (
            <Link className="adm-btn alt" href={target(page - 1)}>
              Предишна
            </Link>
          )}
          {page * 40 < Number(count[0].total) && (
            <Link className="adm-btn alt" href={target(page + 1)}>
              Следваща
            </Link>
          )}
        </div>
      </Panel>
    </>
  );
}
