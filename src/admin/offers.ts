import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { InputIssue } from "./http";
import {
  arr,
  date,
  integer,
  on,
  price,
  string,
  uuid,
  type Values,
} from "./input";

export async function saveOffer(c: PoolClient, d: Values) {
  const id = uuid(d, "id", true);
  const primary = uuid(d, "variant")!;
  const selected = [
    ...new Set([
      primary,
      ...arr(d, "otherVariants[]").map((v) => uuid({ v }, "v")!),
    ]),
  ];
  if (selected.length > 100)
    throw new InputIssue("Избери до 100 варианта в една оферта.");
  const starts = date(d, "start")!,
    ends = date(d, "end")!;
  const cents = price(d, "price", true),
    buy = integer(d, "buy", 1, 1000, 1),
    pay = integer(d, "pay", 0, buy, buy);
  const terms = string(d, "terms", 800),
    approved = on(d, "approved");
  const maxGroups = string(d, "maxGroups")
    ? integer(d, "maxGroups", 1, 1000)
    : null;
  if (ends < starts)
    throw new InputIssue("Крайната дата трябва да е след началната.");
  if (cents === null && buy === pay)
    throw new InputIssue("Попълни промоционална цена или пакетно условие.");
  if (buy !== pay && !terms)
    throw new InputIssue("Опиши пакетното условие за клиента.");
  if (buy === pay && (selected.length > 1 || maxGroups !== null))
    throw new InputIssue(
      "Различни варианти в група и лимит на групите изискват пакетна оферта.",
    );
  await c.query(
    "select pg_advisory_xact_lock(hashtext('mikaela.local.offers'))",
  );
  let prior: Record<string, any>[] = [];
  if (id) {
    const seed = (
      await c.query("select * from offers where id=$1 for update", [id])
    ).rows[0];
    if (!seed || seed.campaign_id)
      throw new InputIssue(
        "Офертата от брошурата се управлява от екрана за брошури.",
      );
    prior = seed.group_id
      ? (
          await c.query(
            "select * from offers where group_id=$1 and campaign_id is null order by id for update",
            [seed.group_id],
          )
        ).rows
      : [seed];
  }
  const variants = (
    await c.query(
      "select id,unit,regular_cents,local_cents,local_until from variants where id=any($1::uuid[]) order by id for update",
      [selected],
    )
  ).rows;
  if (variants.length !== selected.length)
    throw new InputIssue("Избери съществуващи разновидности.");
  if (buy !== pay && variants.some((v) => v.unit !== "piece"))
    throw new InputIssue("Пакетната оферта се прилага за артикули на брой.");
  if (
    approved &&
    cents === null &&
    variants.some(
      (v) =>
        v.regular_cents === null &&
        (v.local_cents === null || (v.local_until && v.local_until < ends)),
    )
  )
    throw new InputIssue(
      "Потвърди цена за единична бройка за целия период и всеки вариант.",
    );
  if (
    approved &&
    (
      await c.query(
        "select 1 from offers where variant_id=any($1::uuid[]) and approved and starts<=$3 and ends>=$2 and not(id=any($4::uuid[])) limit 1",
        [selected, starts, ends, prior.map((o) => o.id)],
      )
    ).rowCount
  )
    throw new InputIssue(
      "Има друга одобрена оферта за избран вариант през този период.",
    );
  const groupId =
    selected.length > 1 ? prior[0]?.group_id || randomUUID() : null;
  const removed = prior.filter((o) => !selected.includes(o.variant_id));
  if (removed.length)
    await c.query("delete from offers where id=any($1::uuid[])", [
      removed.map((o) => o.id),
    ]);
  for (const variant of selected) {
    const values = [
      variant,
      starts,
      ends,
      cents,
      buy,
      pay,
      terms,
      approved,
      groupId,
      maxGroups,
    ];
    const previous = prior.find((o) => o.variant_id === variant);
    if (previous)
      await c.query(
        "update offers set variant_id=$1,starts=$2,ends=$3,price_cents=$4,buy=$5,pay=$6,terms=$7,approved=$8,group_id=$9,max_groups=$10 where id=$11",
        [...values, previous.id],
      );
    else
      await c.query(
        "insert into offers(variant_id,starts,ends,price_cents,buy,pay,terms,approved,group_id,max_groups) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        values,
      );
  }
  return {};
}
