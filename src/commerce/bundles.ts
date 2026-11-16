export type BundleRule = {
  buy: number;
  pay: number;
  group_id?: string | null;
  max_groups?: number | null;
};
export type PricingLine = {
  variantId: string;
  unitCents: number;
  regularCents?: number | null;
  quantity: number;
  offer?: BundleRule | null;
};

export function amountFor(
  unitCents: number,
  quantity: number,
  offer?: BundleRule | null,
  regularCents?: number | null,
) {
  const milli = Math.round(quantity * 1000);
  if (!Number.isSafeInteger(milli) || milli < 0)
    throw Error("Невалидно количество.");
  if (offer && offer.buy > 1) {
    if (milli % 1000 !== 0) throw Error("Пакетната оферта е за цели бройки.");
    const groups = Math.min(
      Math.floor(quantity / offer.buy),
      offer.max_groups ?? Infinity,
    );
    return (
      groups * offer.pay * unitCents +
      (quantity - groups * offer.buy) * (regularCents ?? unitCents)
    );
  }
  return Math.floor((unitCents * milli + 500) / 1000);
}

// Mixed groups are opt-in. Allocate free units from the cheapest eligible lines,
// keeping ungrouped or capped-out pieces at the confirmed standalone price.
export function basketAmounts(lines: PricingLine[]): number[] {
  const amounts = lines.map((i) =>
    amountFor(i.unitCents, i.quantity, i.offer, i.regularCents),
  );
  const mixed = new Map<string, number[]>();
  for (const [index, line] of lines.entries()) {
    const key = line.offer?.group_id;
    if (key && line.offer!.buy > 1) {
      const members = mixed.get(key) || [];
      members.push(index);
      mixed.set(key, members);
    }
  }
  for (const indices of mixed.values()) {
    const rule = lines[indices[0]].offer!;
    if (
      indices.some((i) => {
        const r = lines[i].offer!;
        return (
          r.buy !== rule.buy ||
          r.pay !== rule.pay ||
          r.max_groups !== rule.max_groups
        );
      })
    )
      throw Error("Несъвместими правила за пакетна оферта.");
    const count = indices.reduce((n, i) => n + lines[i].quantity, 0);
    const groups = Math.min(
      Math.floor(count / rule.buy),
      rule.max_groups ?? Infinity,
    );
    let free = groups * (rule.buy - rule.pay),
      paid = groups * rule.pay;
    indices.sort(
      (a, b) =>
        lines[a].unitCents - lines[b].unitCents ||
        lines[a].variantId.localeCompare(lines[b].variantId),
    );
    for (const i of indices) {
      const line = lines[i],
        discounted = Math.min(line.quantity, free);
      free -= discounted;
      const charged = Math.min(line.quantity - discounted, paid);
      paid -= charged;
      amounts[i] =
        charged * line.unitCents +
        (line.quantity - discounted - charged) *
          (line.regularCents ?? line.unitCents);
    }
  }
  return amounts;
}
