import { notFound } from "next/navigation";
import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { getSettings } from "@/commerce/catalog";
import { PageHeading, Panel } from "@/admin/presentation";
import { PrintButton } from "@/admin/widgets";
import { dateTime, money, label } from "@/admin/format";
import { address, interval, OrderTotal } from "@/admin/order-ui";
import { lineName, claimLine } from "@/commerce/order-line";

export default async function PrintOrder({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireStaff(["staff"]);
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const picking = (await searchParams).mode === "pick";
  const [order] = await query("select * from orders where id=$1", [id]);
  if (!order) notFound();
  const items = await query(
    `select i.*,coalesce(i.snapshot->>'categoryName',c.name,'Други') category_name from order_items i left join variants v on v.id=i.variant_id left join products p on p.id=v.product_id left join categories c on c.id=p.category_id where i.order_id=$1 order by category_name,i.snapshot->>'productName'`,
    [id],
  );
  const seller = order.terms_snapshot?.seller || (await getSettings());
  return (
    <>
      <PageHeading
        title={
          (picking ? "Списък за събиране" : "Потвърждение за поръчка") +
          " № " +
          order.number
        }
        subtitle={dateTime(order.created_at)}
        action={<PrintButton />}
      />
      <Panel>
        <p>
          <strong>{seller.company || seller.name}</strong>
          {seller.companyId ? " · ЕИК " + seller.companyId : ""}
          <br />
          {[seller.city, seller.address, seller.phone, seller.email]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <dl className="adm-dl">
          <dt>Получател</dt>
          <dd>{order.customer.name}</dd>
          <dt>Доставка</dt>
          <dd>{interval(order)}</dd>
          {!picking && (
            <>
              <dt>Адрес</dt>
              <dd>{address(order)}</dd>
              <dt>Плащане при доставка</dt>
              <dd>{label(order.payment_method)}</dd>
            </>
          )}
        </dl>
      </Panel>
      <Panel title={picking ? "Събиране по категории" : "Артикули"}>
        <div className="adm-tablewrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Продукт и вариант</th>
                <th>Заявено</th>
                <th>Подготвено</th>
                <th>{picking ? "Събрано" : "Крайна сума"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.status === "replaced" ? lineName(claimLine(i)) : i.snapshot.productName}</strong>
                    <br />
                    {i.status !== "replaced" && <>{i.snapshot.variantName} · {i.snapshot.pack} · {i.category_name}</>}
                    {i.status !== "replaced" && i.snapshot.terms && <p>{i.snapshot.terms}</p>}
                    {i.status === "replaced" && (
                      <>
                        {i.change_detail.prepared?.offer?.terms && <p>{i.change_detail.prepared.offer.terms}</p>}
                        <p>Съгласувана замяна на {lineName({ id: i.id, ...i.snapshot })}</p>
                      </>
                    )}
                    {i.status === "missing" && <p>Пропуснат поради липса.</p>}
                    {picking ? (
                      <small>
                        {i.substitution === "call"
                          ? "Обаждане за замяна"
                          : "Пропусни при липса"}{" "}
                        · {i.note}
                      </small>
                    ) : (
                      <small>
                        Единична цена{" "}
                        {money(
                          i.change_detail.prepared?.unitCents ?? i.unit_cents,
                        )}
                      </small>
                    )}
                  </td>
                  <td>
                    {Number(i.quantity)}{" "}
                    {i.snapshot.unit === "kg" ? "кг" : "бр."}
                  </td>
                  <td>
                    {i.prepared_quantity == null
                      ? "—"
                      : Number(i.prepared_quantity) +
                        " " +
                        ((i.change_detail.prepared?.unit || i.snapshot.unit) ===
                        "kg"
                          ? "кг"
                          : "бр.")}
                  </td>
                  <td>{picking ? "□" : money(i.line_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {!picking && (
        <>
          <Panel title="Стойност и плащане">
            <OrderTotal o={order} />
            <p>{label(order.payment_status)}</p>
          </Panel>
          <Panel title={"Общи условия · версия " + order.terms_version}>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {order.terms_snapshot?.body}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
