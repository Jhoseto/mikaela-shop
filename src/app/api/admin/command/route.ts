import { NextResponse } from "next/server";
import { requireStaff } from "@/auth/access";
import { createStaff, setRoles } from "@/auth/manage";
import { query, tx } from "@/db";
import { changeOrder } from "@/commerce/orders";
import { claimLine } from "@/commerce/order-line";
import {
  sameOrigin,
  limitedBody,
  errorResponse,
  InputIssue,
} from "@/admin/http";
import {
  type Values,
  string,
  uuid,
  one,
  arr,
  price,
  grams,
  on,
} from "@/admin/input";
import { productCommand } from "@/admin/product-commands";
import { manage } from "@/admin/management-commands";
const ownerPrefixes = [
  "settings",
  "staff",
  "page",
  "category",
  "delivery",
  "zone",
  "synonym",
];
const descriptions: Record<string, string> = {
  "notification.retry": "Повторно изпращане на известие",
  "product.save": "Редактиране на продукт",
  "product.quick": "Бърза промяна на продукт",
  "product.restore": "Възстановяване от брошура",
  "product.duplicate": "Дублиране на продукт",
  "product.bulk": "Групово действие върху продукти",
  "settings.save": "Промяна на настройките",
  "settings.pause": "Временно спиране на поръчките",
  "zone.save": "Редакция на район",
  "delivery.rule": "Работен интервал",
  "delivery.exception": "Празнично изключение",
  "category.save": "Редакция на категория",
  "page.save": "Редакция на страница",
  "page.carousel": "Редакция на началния карусел",
  "offer.save": "Редакция на оферта",
  "synonym.save": "Синоними",
  "staff.create": "Нов служебен профил",
  "staff.roles": "Промяна на служебни права",
  "claim.create": "Регистрация на рекламация",
  "order.propose": "Предложение за замяна",
};
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      throw new InputIssue("Невалиден тип заявка.");
    let parsed: any;
    try {
      parsed = JSON.parse((await limitedBody(req, 150000)).toString("utf8"));
    } catch (e) {
      if (e instanceof InputIssue) throw e;
      throw new InputIssue("Невалиден формуляр.");
    }
    const command = parsed?.command,
      d = parsed?.data as Values;
    if (
      typeof command !== "string" ||
      !d ||
      Array.isArray(d) ||
      typeof d !== "object"
    )
      throw new InputIssue("Невалиден формуляр.");
    const [group, action] = command.split(".");
    const courierAction =
      group === "order" && ["deliver", "problem", "payment"].includes(action);
    const actor = await requireStaff(
      ownerPrefixes.includes(group)
        ? ["owner"]
        : courierAction
          ? ["staff", "courier"]
          : ["staff"],
    );
    if (group === "order" && action !== "propose") {
      const orderId = uuid(d, "id")!;
      let payload: Record<string, any> = { reason: string(d, "reason", 1200) };
      switch (action) {
        case "assign":
          payload.courierId = string(d, "courier", 120, true);
          break;
        case "move":
          payload.slotId = uuid(d, "slot");
          break;
        case "payment":
        case "refund":
          payload.amountCents = price(d, "amount");
          payload.method = one(d, "method", ["cash", "card"]);
          break;
        case "item":
          payload.itemId = uuid(d, "item");
          payload.status = one(d, "itemStatus", [
            "prepared",
            "missing",
            "replaced",
          ]);
          payload.quantity = grams(d, "quantity");
          payload.variantId = uuid(d, "variant", true) || undefined;
          if (on(d, "consent")) {
            payload.approval = {
              by: string(d, "approvalBy", 160, true),
              channel: one(d, "channel", [
                "phone",
                "sms",
                "in_person",
                "email",
              ]),
            };
          }
          break;
        case "contact":
          payload.itemId = uuid(d, "item");
          payload.channel = one(d, "channel", [
            "phone",
            "sms",
            "in_person",
            "email",
          ]);
          break;
        case "resolveClaim":
          payload.claimId = uuid(d, "claim");
          payload.status = one(d, "claimStatus", [
            "accepted",
            "rejected",
            "resolved",
          ]);
          break;
        case "deliver":
          payload.ageChecked = on(d, "ageChecked");
          break;
        case "wait":
        case "resume":
        case "confirm":
        case "prepare":
        case "ready":
        case "dispatch":
        case "cancel":
        case "problem":
          break;
        default:
          throw new InputIssue("Неизвестно действие.");
      }
      await changeOrder(orderId, action, payload, actor);
      return NextResponse.json({});
    }
    if (group === "staff") {
      let id = string(d, "id", 120);
      const roles = arr(d, "roles[]");
      if (action === "create")
        id = await createStaff(
          string(d, "name", 180, true),
          string(d, "email", 250, true),
          String(d.password || ""),
          roles,
        );
      else if (action === "roles") await setRoles(id, roles);
      else throw new InputIssue("Неизвестно действие.");
      await query(
        "insert into audit_log(actor,action,entity,detail) values($1,$2,$3,$4)",
        [actor.id, command, id, { roles, label: descriptions[command] }],
      );
      return NextResponse.json({});
    }
    const result = await tx(async (c) => {
      let result: { href?: string; message?: string } = {};
      if (group === "product") result = await productCommand(c, command, d);
      else if (command === "claim.create" || command === "order.propose") {
        const id = uuid(d, "id"),
          order = (
            await c.query("select status from orders where id=$1 for update", [
              id,
            ])
          ).rows[0];
        if (!order) throw new InputIssue("Поръчката липсва.");
        const reason = string(d, "reason", 2000, true);
        if (command === "claim.create") {
          const ids = arr(d, "items[]").map((item) => uuid({ item }, "item"));
          const valid = (
            await c.query(
              "select id,variant_id,snapshot,change_detail from order_items where order_id=$1 and id=any($2::uuid[]) order by id",
              [id, ids],
            )
          ).rows;
          if (!ids.length || valid.length !== new Set(ids).size)
            throw new InputIssue("Избери конкретни артикули от поръчката.");
          const claim = (
            await c.query(
              "insert into claims(order_id,kind,item_ids,reason,contact,item_details) values($1,'claim',$2,$3,$4,$5) returning id",
              [
                id,
                ids,
                reason,
                {
                  channel: one(d, "channel", [
                    "phone",
                    "sms",
                    "in_person",
                    "email",
                  ]),
                },
                JSON.stringify(valid.map(claimLine)),
              ],
            )
          ).rows[0];
          await c.query(
            "insert into order_events(order_id,actor,kind,detail) values($1,$2,'claim',$3)",
            [id, actor.id, { claimId: claim.id }],
          );
        } else {
          if (!["waiting", "preparing", "confirmed"].includes(order.status))
            throw new InputIssue(
              "Замени се предлагат при приемане и подготовка.",
            );
          const item = uuid(d, "item"),
            variant = uuid(d, "variant");
          const row = (
            await c.query(
              "select substitution from order_items where order_id=$1 and id=$2 for update",
              [id, item],
            )
          ).rows[0];
          if (!row || row.substitution === "skip")
            throw new InputIssue(
              "Клиентът не е поискал предложение за замяна.",
            );
          const replacement = (
            await c.query(
              `select v.id,v.name,v.pack,p.name product from variants v join products p on p.id=v.product_id
               where v.id=$1 and p.status='published' and v.available and p.available
               and (coalesce((p.food||v.food)->>'ageRestricted','false')<>'true'
                 or exists(select 1 from settings where key='site' and value->>'ageEnabled'='true'))`,
              [variant],
            )
          ).rows[0];
          if (!replacement) throw new InputIssue("Избери разновидност.");
          const proposal = {
            variantId: variant,
            name: [
              replacement.product,
              replacement.name,
              replacement.pack,
            ].join(" · "),
            reason,
            by: actor.id,
            at: new Date().toISOString(),
          };
          await c.query(
            "update order_items set change_detail=jsonb_set(change_detail,'{proposal}',$2) where id=$1",
            [item, proposal],
          );
          await c.query(
            "insert into order_events(order_id,actor,kind,detail) values($1,$2,'substitution_proposed',$3)",
            [id, actor.id, { itemId: item, ...proposal }],
          );
        }
      } else result = await manage(c, command, d);
      await c.query(
        "insert into audit_log(actor,action,entity,detail) values($1,$2,$3,$4)",
        [
          actor.id,
          command,
          string(d, "id", 200) ||
            String(result.href || d.slug || d.name || group).slice(0, 200),
          {
            label: descriptions[command] || command,
            count:
              command === "product.bulk" ? arr(d, "ids[]").length : undefined,
          },
        ],
      );
      return result;
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
