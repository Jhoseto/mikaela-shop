"use client";
import { useState } from "react";
import { CommandForm, Field, Submit } from "./widgets";
import { PhotoEditor, type Photo } from "./photo-editor";
import { Panel } from "./presentation";
type Row = Record<string, any>;
const foodFields: { key: string; title: string }[] = [
  { key: "ingredients", title: "Състав" },
  { key: "allergens", title: "Алергени" },
  { key: "net", title: "Нетно количество" },
  { key: "storage", title: "Условия за съхранение" },
  { key: "nutrition", title: "Хранителни стойности" },
  { key: "operator", title: "Производител / отговорен оператор" },
  { key: "origin", title: "Произход, когато е приложимо" },
  { key: "source", title: "Източник на данните и основание за изключения" },
];
const euro = (v: number | null) => (v == null ? "" : (v / 100).toFixed(2));
export function ProductEditor({
  product,
  initialVariants,
  photos,
  categories,
}: {
  product: Row;
  initialVariants: Row[];
  photos: Photo[];
  categories: Row[];
}) {
  const [variants, setVariants] = useState<Row[]>(
    initialVariants.length
      ? initialVariants
      : [{ unit: "piece", available: true }],
  );
  const [foodType, setFoodType] = useState(product.food?.type || "packaged");
  return (
    <CommandForm command="product.save">
      <input type="hidden" name="id" value={product.id || ""} />
      <input type="hidden" name="revision" value={product.revision || ""} />
      <Panel title="Данни за продукта">
        <div className="adm-fields">
          <Field title="Име на продукта">
            <input
              name="name"
              defaultValue={product.name}
              maxLength={220}
              required
            />
          </Field>
          <div className="adm-grid">
            <Field title="Категория">
              <select name="category" defaultValue={product.category_id || ""}>
                <option value="">Избери категория</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Марка">
              <input name="brand" defaultValue={product.brand} />
            </Field>
          </div>
          <details className="adm-details">
            <summary>Създай нова категория</summary>
            <Field title="Име на новата категория">
              <input name="newCategory" maxLength={110} />
            </Field>
          </details>
          <Field title="Кратко описание">
            <textarea name="description" defaultValue={product.description} />
          </Field>
          <label className="adm-check">
            <input
              type="checkbox"
              name="available"
              defaultChecked={product.available ?? true}
            />
            Наличен за онлайн поръчки
          </label>
        </div>
      </Panel>
      <Panel title="Снимки">
        <PhotoEditor name="photos" initial={photos} />
      </Panel>
      <Panel title="Разфасовки и цени">
        <input type="hidden" name="variantCount" value={variants.length} />
        {variants.map((v, i) => (
          <VariantBox v={v} index={i} foodType={foodType} key={v.id || i} />
        ))}
        <button
          className="adm-btn alt"
          type="button"
          onClick={() =>
            setVariants([...variants, { available: true, unit: "piece" }])
          }
        >
          Добави разновидност
        </button>
      </Panel>
      <Panel title="Продуктова информация">
        <Field title="Вид продукт">
          <select
            name="foodType"
            value={foodType}
            onChange={(e) => setFoodType(e.target.value)}
          >
            <option value="packaged">Предварително опакована храна</option>
            <option value="unpackaged">Неопакована храна</option>
            <option value="nonfood">Нехранителна стока</option>
          </select>
        </Field>
        {foodType !== "nonfood" && (
          <div className="adm-grid" style={{ marginTop: 14 }}>
            {foodFields.map(({ key, title }) => (
              <Field key={key} title={title}>
                <textarea
                  name={key}
                  defaultValue={product.food?.[key]}
                  rows={2}
                />
              </Field>
            ))}
          </div>
        )}
        {foodType !== "nonfood" && (
          <details className="adm-details">
            <summary>Полета с потвърдено изключение за тази категория</summary>
            <div className="adm-grid">
              {foodFields
                .filter((f) => f.key !== "source")
                .map((f) => (
                  <label key={f.key} className="adm-check">
                    <input
                      type="checkbox"
                      name="exemptions[]"
                      value={f.key}
                      defaultChecked={product.food?.exemptions?.includes(f.key)}
                    />
                    {f.title}
                  </label>
                ))}
            </div>
          </details>
        )}
        <div className="adm-grid" style={{ marginTop: 14 }}>
          <Field title="Право на отказ">
            <select
              name="withdrawal"
              defaultValue={product.food?.withdrawal || "eligible"}
            >
              <option value="eligible">Приложимо</option>
              <option value="perishable">Бързоразваляща се стока</option>
              <option value="sealed">Запечатана хигиенна стока</option>
            </select>
          </Field>
          <label className="adm-check">
            <input
              type="checkbox"
              name="ageRestricted"
              defaultChecked={product.food?.ageRestricted}
            />
            Изисква проверка на възрастта
          </label>
        </div>
        <details className="adm-details">
          <summary>Заглавие и описание за търсачки</summary>
          <div className="adm-fields">
            <Field title="SEO заглавие">
              <input
                name="seoTitle"
                defaultValue={product.local_settings?.seo?.title}
              />
            </Field>
            <Field title="SEO описание">
              <textarea
                name="seoDescription"
                defaultValue={product.local_settings?.seo?.description}
              />
            </Field>
          </div>
        </details>
      </Panel>
      <div className="adm-actions">
        <Submit name="status" value={product.status || "draft"}>
          {!product.status || product.status === "draft"
            ? "Запази чернова"
            : "Запази промените"}
        </Submit>
        {product.status !== "published" && (
          <Submit name="status" value="published" secondary>
            Публикувай
          </Submit>
        )}
        {product.id && (
          <>
            <Submit name="status" value="hidden" secondary>
              Скрий
            </Submit>
            <Submit name="status" value="archived" secondary>
              Архивирай
            </Submit>
          </>
        )}
      </div>
    </CommandForm>
  );
}
function VariantBox({
  v,
  index,
  foodType,
}: {
  v: Row;
  index: number;
  foodType: string;
}) {
  const p = "v" + index + "_";
  const [local, setLocal] = useState(v.local_cents != null);
  return (
    <section className="adm-details">
      <h3>Разновидност {index + 1}</h3>
      <input type="hidden" name={p + "id"} value={v.id || ""} />
      <div className="adm-grid">
        <Field title="Име / вкус">
          <input name={p + "name"} defaultValue={v.name} />
        </Field>
        <Field title="Разфасовка">
          <input
            name={p + "pack"}
            defaultValue={v.pack}
            placeholder="напр. 500 г"
          />
        </Field>
        <Field title="Продажна единица">
          <select name={p + "unit"} defaultValue={v.unit}>
            <option value="piece">Брой / опаковка</option>
            <option value="kg">По действително тегло (кг)</option>
          </select>
        </Field>
        <Field title="Редовна цена (€)">
          <input
            inputMode="decimal"
            name={p + "regular"}
            defaultValue={euro(v.regular_cents)}
          />
        </Field>
      </div>
      <details className="adm-details">
        <summary>Местна цена, наличност и баркод</summary>
        <div className="adm-grid">
          <Field title="Ценообразуване">
            <select
              name={p + "mode"}
              value={local ? "local" : "source"}
              onChange={(e) => setLocal(e.target.value === "local")}
            >
              <option value="source">Следвай брошурата</option>
              <option value="local">Местна цена</option>
            </select>
          </Field>
          {local && (
            <>
              <Field title="Местна цена (€)">
                <input
                  name={p + "local"}
                  defaultValue={euro(v.local_cents)}
                  inputMode="decimal"
                  required
                />
              </Field>
              <Field
                title="В сила до"
                hint="Празна дата означава постоянно действие."
              >
                <input
                  type="date"
                  name={p + "until"}
                  defaultValue={v.local_until || ""}
                />
              </Field>
            </>
          )}
          <Field title="Лимит за онлайн поръчки">
            <input
              name={p + "limit"}
              inputMode="decimal"
              defaultValue={v.online_limit || ""}
            />
          </Field>
          <Field title="Баркод">
            <input name={p + "barcode"} defaultValue={v.barcode || ""} />
          </Field>
          <label className="adm-check">
            <input
              type="checkbox"
              name={p + "available"}
              defaultChecked={v.available ?? true}
            />
            Разновидността е налична
          </label>
        </div>
      </details>
      {foodType !== "nonfood" && (
        <details className="adm-details">
          <summary>Етикет на тази разновидност</summary>
          <p className="adm-caption">
            Попълни различаващите се данни за този вкус или разфасовка. Празните
            полета използват общата информация за продукта.
          </p>
          <div className="adm-grid">
            {foodFields.map((f) => (
              <Field key={f.key} title={f.title}>
                <textarea
                  rows={2}
                  name={p + "food_" + f.key}
                  defaultValue={v.food?.[f.key] || ""}
                />
              </Field>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
