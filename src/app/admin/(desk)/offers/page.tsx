import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { today } from "@/commerce/catalog";
import { Field, CommandForm, Submit } from "@/admin/widgets";
import { PageHeading, Panel } from "@/admin/presentation";
import { money } from "@/admin/format";
function Offer({
  o,
  variants,
}: {
  o: Record<string, any>;
  variants: Record<string, any>[];
}) {
  return (
    <CommandForm command="offer.save">
      <input type="hidden" name="id" value={o.id || ""} />
      <div className="adm-grid">
        <Field title="Точен продукт и разновидност">
          <select name="variant" defaultValue={o.variant_id || ""} required>
            <option value="">Избери…</option>
            {variants.map((v) => (
              <option value={v.id} key={v.id}>
                {v.product} · {v.name} · {v.pack}
              </option>
            ))}
          </select>
        </Field>
        <Field title="От">
          <input
            type="date"
            name="start"
            defaultValue={o.starts || today()}
            required
          />
        </Field>
        <Field title="До">
          <input type="date" name="end" defaultValue={o.ends || ""} required />
        </Field>
        <Field title="Цена за брой или килограм (€)">
          <input
            name="price"
            inputMode="decimal"
            defaultValue={
              o.price_cents == null ? "" : (o.price_cents / 100).toFixed(2)
            }
          />
        </Field>
        <Field title="Вземи (брой)">
          <input type="number" min="1" name="buy" defaultValue={o.buy ?? 1} />
        </Field>
        <Field title="Плати (брой)">
          <input type="number" min="0" name="pay" defaultValue={o.pay ?? 1} />
        </Field>
        <Field
          title="Максимум групи за една поръчка"
          hint="Празно означава без лимит."
        >
          <input
            type="number"
            min="1"
            max="1000"
            name="maxGroups"
            defaultValue={o.max_groups ?? ""}
          />
        </Field>
        <Field title="Условие и ограничения">
          <textarea name="terms" defaultValue={o.terms} />
        </Field>
        <label className="adm-check">
          <input
            type="checkbox"
            name="approved"
            defaultChecked={o.approved ?? false}
          />
          Одобрена за периода
        </label>
      </div>
      <details className="adm-details">
        <summary>Допълнителни варианти за смесена пакетна оферта</summary>
        <p>
          При смесване на избраните разновидности отстъпката се прилага върху
          най-евтините допустими бройки.
        </p>
        <div className="adm-grid">
          {variants
            .filter((v) => v.unit === "piece" && v.id !== o.variant_id)
            .map((v) => (
              <label className="adm-check" key={v.id}>
                <input
                  type="checkbox"
                  name="otherVariants[]"
                  value={v.id}
                  defaultChecked={o.members?.includes(v.id)}
                />
                {v.product} · {v.name} · {v.pack}
              </label>
            ))}
        </div>
      </details>
      <div className="adm-actions">
        <Submit>Запази офертата</Submit>
      </div>
    </CommandForm>
  );
}
export default async function Offers() {
  await requireStaff(["staff"]);
  const [offers, variants] = await Promise.all([
    query(
      "select o.*,v.name,p.name product from offers o join variants v on v.id=o.variant_id join products p on p.id=v.product_id order by o.ends desc,p.name",
    ),
    query(
      "select v.id,v.name,v.pack,v.unit,p.name product from variants v join products p on p.id=v.product_id where p.status<>$1 order by p.name,v.name",
      ["archived"],
    ),
  ]);
  const grouped = new Map<string, Record<string, any>>();
  for (const offer of offers) {
    const key = offer.group_id || offer.id;
    const existing = grouped.get(key);
    if (existing) existing.members.push(offer.variant_id);
    else grouped.set(key, { ...offer, members: [offer.variant_id] });
  }
  return (
    <>
      <PageHeading title="Промоции" />
      <Panel title="Нова местна оферта">
        <Offer o={{}} variants={variants} />
      </Panel>
      <Panel title="Оферти">
        {offers.length === 0
          ? "Няма въведени оферти."
          : [...grouped.values()].map((o) => (
              <details className="adm-details" key={o.id}>
                <summary>
                  {o.product} · {money(o.price_cents)} · {o.ends} ·{" "}
                  {o.approved ? "одобрена" : "чернова"}
                  {o.members.length > 1
                    ? " · " + o.members.length + " варианта"
                    : ""}
                </summary>
                {o.campaign_id ? (
                  <p>
                    {o.terms}{" "}
                    <a className="adm-link" href="/admin/broshuri">
                      Управление в брошурите
                    </a>
                  </p>
                ) : (
                  <Offer o={o} variants={variants} />
                )}
              </details>
            ))}
      </Panel>
    </>
  );
}
