import { InputIssue } from "./http";

export type Values = Record<string, unknown>;
export function string(d: Values, k: string, max = 500, required = false) {
  const val = typeof d[k] === "string" ? (d[k] as string).trim() : "";
  if (val.length > max || (required && !val))
    throw new InputIssue(
      "Провери задължителните полета и дължината на текста.",
    );
  return val;
}
export function one(
  d: Values,
  k: string,
  choices: string[],
  fallback?: string,
) {
  const value = string(d, k) || fallback;
  if (value === undefined || !choices.includes(value))
    throw new InputIssue("Избери валидна опция.");
  return value;
}
export function uuid(d: Values, k: string, optional = false) {
  const v = string(d, k);
  if (!v && optional) return null;
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v))
    throw new InputIssue("Невалиден запис. Презареди страницата.");
  return v;
}
export function integer(
  d: Values,
  k: string,
  min = 0,
  max = 10000,
  fallback?: number,
) {
  const raw = string(d, k);
  if (!raw && fallback !== undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    throw new InputIssue("Провери въведените количества и интервали.");
  return Number(raw);
}
export function price(d: Values, k: string, optional = false) {
  const v = string(d, k).replace(",", ".");
  if (!v && optional) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v))
    throw new InputIssue("Въведи цена в евро с до два знака след запетаята.");
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
export function grams(d: Values, k: string) {
  const v = string(d, k).replace(",", ".");
  if (!v) return null;
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(v))
    throw new InputIssue(
      "Количеството трябва да е положително с до три десетични знака.",
    );
  return v;
}
export const on = (d: Values, k: string) =>
  d[k] === "on" || d[k] === "true" || d[k] === true;
export function arr(d: Values, k: string) {
  return Array.isArray(d[k]) ? (d[k] as unknown[]).map(String) : [];
}
export function date(d: Values, k: string, optional = false) {
  const v = string(d, k);
  if (!v && optional) return null;
  if (
    !/^\d{4}-\d\d-\d\d$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new InputIssue("Въведи валидна дата.");
  return v;
}
export function time(d: Values, k: string, optional = false) {
  const v = string(d, k);
  if (!v && optional) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(v))
    throw new InputIssue("Въведи час във формат 09:30.");
  return v;
}
export function media(d: Values, k: string) {
  let values: unknown;
  try {
    values = JSON.parse(String(d[k] || "[]"));
  } catch {
    throw new InputIssue("Невалиден списък със снимки.");
  }
  if (!Array.isArray(values) || values.length > 14)
    throw new InputIssue("Избери до 14 снимки.");
  const urls = values.map((o) =>
    typeof o === "object" && o ? String(o.url) : "",
  );
  if (
    urls.some(
      (v) => !/^\/media\/[A-Za-z0-9_./-]+$/.test(v) || v.includes(".."),
    ) ||
    new Set(urls).size !== urls.length
  )
    throw new InputIssue("Избери изображения, качени в магазина.");
  return urls;
}
export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 75) || "produkt"
  );
}
