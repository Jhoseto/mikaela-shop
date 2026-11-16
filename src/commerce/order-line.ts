export type ClaimLine = {
  id: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  pack?: string;
};

export function claimLine(row: Record<string, any>): ClaimLine {
  const value = row.prepared || row.change_detail?.prepared || row.snapshot;
  return {
    id: row.id,
    variantId: value.variantId || row.variant_id,
    productName: value.productName || value.name,
    variantName: value.variantName,
    pack: value.pack,
  };
}

export function lineName(line: ClaimLine) {
  return [line.productName, line.variantName !== line.productName && line.variantName, line.pack]
    .filter(Boolean).join(" · ");
}
