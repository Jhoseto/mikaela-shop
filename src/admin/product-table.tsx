"use client";
import { useState } from "react";
import Link from "next/link";
import { Field, CommandForm, Submit } from "./widgets";
import { money, label } from "./format";
export function ProductTable({ rows }: { rows: Record<string, any>[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  function toggle(id: string) {
    setSelected(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  }
  return (
    <>
      <CommandForm command="product.bulk">
        <div className="adm-actions">
          {selected.map((id) => (
            <input key={id} type="hidden" name="ids[]" value={id} />
          ))}
          <Field title={"Групово действие · избрани " + selected.length}>
            <select name="operation">
              <option value="available">Налични</option>
              <option value="unavailable">Изчерпани</option>
              <option value="published">Публикувай</option>
              <option value="hidden">Скрий</option>
              <option value="archived">Архивирай</option>
            </select>
          </Field>
          <Submit secondary>Приложи</Submit>
        </div>
      </CommandForm>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Избери всички на страницата"
                  checked={
                    rows.length > 0 &&
                    rows.every((r) => selected.includes(r.id))
                  }
                  onChange={(e) =>
                    setSelected(e.target.checked ? rows.map((r) => r.id) : [])
                  }
                />
              </th>
              <th>Продукт</th>
              <th>Статус</th>
              <th>Бърза промяна</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={"Избери " + r.name}
                    checked={selected.includes(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td>
                  <Link href={"/admin/products/" + r.id}>
                    <strong>{r.name}</strong>
                  </Link>
                  <br />
                  <small>
                    {r.category || "Без категория"} ·{" "}
                    {r.origin === "local" ? "От магазина" : "Брошура"}
                  </small>
                </td>
                <td>
                  <span className={"adm-pill s-" + r.status}>
                    {label(r.status)}
                  </span>
                  <br />
                  <small>{r.available ? "Наличен" : "Изчерпан"}</small>
                </td>
                <td>
                  <details>
                    <summary>
                      {r.regular_cents == null
                        ? "Редактирай"
                        : money(r.regular_cents)}
                    </summary>
                    <CommandForm command="product.quick">
                      <input type="hidden" name="id" value={r.id} />
                      <input
                        type="hidden"
                        name="variant"
                        value={r.variant || ""}
                      />
                      {r.variant && (
                        <Field title={"Редовна цена · " + r.variant_name}>
                          <input
                            name="regular"
                            inputMode="decimal"
                            defaultValue={
                              r.regular_cents == null
                                ? ""
                                : (r.regular_cents / 100).toFixed(2)
                            }
                          />
                        </Field>
                      )}
                      <label className="adm-check">
                        <input
                          name="available"
                          type="checkbox"
                          defaultChecked={r.available}
                        />
                        Наличен
                      </label>
                      <br />
                      <Submit secondary>Запази</Submit>
                    </CommandForm>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
