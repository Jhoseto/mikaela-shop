import { notFound } from "next/navigation";
import { query } from "@/db";
import { requireStaff } from "@/auth/access";
import { publicationIssues } from "@/commerce/catalog";
import { priceNeedsReview } from "@/admin/price-check";
import { ProductEditor } from "@/admin/product-editor";
import { PageHeading, Panel, Open, Pill } from "@/admin/presentation";
import { CommandForm, Field, Submit } from "@/admin/widgets";
import { dateTime, money } from "@/admin/format";
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff(["staff"]);
  const { id } = await params;
  const isNew = id === "nov";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [products, variants, photos, categories, history] = await Promise.all([
    isNew ? [] : query("select * from products where id=$1", [id]),
    isNew
      ? []
      : query(
          `select v.*,${priceNeedsReview} price_issue from variants v where product_id=$1 order by name,id`,
          [id],
        ),
    isNew
      ? []
      : query(
          "select url,source from images where product_id=$1 order by sort_order,id",
          [id],
        ),
    query("select * from categories order by sort_order,name"),
    isNew
      ? []
      : query(
          "select h.*,v.name from price_history h join variants v on v.id=h.variant_id where v.product_id=$1 order by h.created_at desc limit 20",
          [id],
        ),
  ]);
  const p = isNew ? { name: "", food: {}, local_settings: {} } : products[0];
  if (!p) notFound();
  const issues = isNew ? [] : publicationIssues(p, variants);
  for (const v of variants)
    if (v.price_issue)
      issues.push(
        v.name +
          " · провери редовната или местната цена и ограничението на активната оферта.",
      );
  return (
    <>
      <PageHeading
        title={isNew ? "Нов продукт" : p.name}
        action={
          p.status === "published" ? (
            <Open href={"/produkti/" + p.slug}>Преглед в сайта</Open>
          ) : undefined
        }
      />
      {!isNew && <Pill value={p.status} />}
      {issues.length > 0 && (
        <Panel title="За попълване">
          <ul>
            {issues.map((x: string) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Panel>
      )}
      <ProductEditor
        product={{ ...p, revision: p.updated_at?.toISOString() }}
        initialVariants={variants}
        photos={photos as { url: string }[]}
        categories={categories}
      />
      {!isNew && (
        <Panel title="Управление">
          <CommandForm command="product.duplicate">
            <input type="hidden" name="id" value={id} />
            <Submit secondary>Дублирай като чернова</Submit>
          </CommandForm>
          {p.origin === "brochure" && (
            <CommandForm command="product.restore">
              <input type="hidden" name="id" value={id} />
              <div className="adm-actions">
                <Field title="Възстанови стойност от брошурата">
                  <select name="field">
                    <option value="image">Снимка</option>
                    <option value="description">Описание</option>
                    <option value="category_id">Категория</option>
                    <option value="name">Име</option>
                    <option value="brand">Марка</option>
                  </select>
                </Field>
                <Submit secondary>Възстанови стойността от източника</Submit>
              </div>
            </CommandForm>
          )}
        </Panel>
      )}
      {!!history.length && (
        <Panel title="История на местните цени">
          <ul className="adm-list">
            {history.map((h) => (
              <li key={h.id}>
                {dateTime(h.created_at)} · {h.name} · редовна{" "}
                {money(h.changes.regular)} · местна {money(h.changes.local)}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
