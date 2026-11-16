import { requireStaff } from "@/auth/access";
import { getSettings } from "@/commerce/catalog";
import { query } from "@/db";
import { Field, CommandForm, Submit } from "@/admin/widgets";
import { PageHeading, Panel } from "@/admin/presentation";
import { PhotoEditor } from "@/admin/photo-editor";

const identity = {
  name: "Име на магазина",
  company: "Наименование на фирмата",
  companyId: "ЕИК",
  city: "Населено място",
  address: "Адрес",
  phone: "Телефон",
  email: "Имейл",
  hours: "Работно време",
  baseUrl: "Публичен адрес на сайта",
};
const gates = {
  registeredFood: "Регистрация за дистанционна търговия с храни",
  transportReady: "Организиран транспорт на храните",
  fiscalReady: "Уредено фискално отчитане",
  brandReady: "Потвърдени права за бранд материалите",
  legalReady: "Утвърдени правни текстове",
};
export default async function Settings() {
  await requireStaff(["owner"]);
  const s = (await getSettings()) as Record<string, any>;
  const synonyms = await query("select * from synonyms order by term");
  return (
    <>
      <PageHeading
        title="Настройки"
        subtitle={
          s.demo ? "Демонстрационна среда" : "Условия и данни на обекта"
        }
      />
      <CommandForm command="settings.save">
        <Panel title="Магазин и контакти">
          <div className="adm-grid">
            {Object.entries(identity).map(([key, title]) => (
              <Field key={key} title={title}>
                <input
                  name={key}
                  type={
                    key === "email"
                      ? "email"
                      : key === "baseUrl"
                        ? "url"
                        : "text"
                  }
                  defaultValue={s[key]}
                  required={key === "name"}
                />
              </Field>
            ))}
          </div>
          <details className="adm-details">
            <summary>Оригинално лого</summary>
            <PhotoEditor
              name="logo"
              single
              initial={s.logo ? [{ url: s.logo }] : []}
            />
          </details>
          <details className="adm-details">
            <summary>Снимка на магазина</summary>
            <PhotoEditor
              name="photo"
              single
              initial={s.photo ? [{ url: s.photo }] : []}
            />
          </details>
        </Panel>
        <Panel title="Поръчки и плащане">
          <div className="adm-fields">
            <label className="adm-check">
              <input
                type="checkbox"
                name="ordersOpen"
                defaultChecked={s.ordersOpen}
              />
              Приемай нови поръчки
            </label>
            <label className="adm-check">
              <input
                type="checkbox"
                name="cardEnabled"
                defaultChecked={s.cardEnabled}
              />
              Наличен е мобилен ПОС за плащане с карта при доставка
            </label>
            <label className="adm-check">
              <input
                type="checkbox"
                name="ageEnabled"
                defaultChecked={s.ageEnabled}
              />
              Включи стоки с ограничение за възраст и проверка при предаване
            </label>
            <div className="adm-grid">
              <Field title="Допълнителна предварително обявена такса (€)">
                <input
                  inputMode="decimal"
                  name="extraFee"
                  defaultValue={(s.extraFeeCents / 100).toFixed(2)}
                />
              </Field>
              <Field title="Допустимо увеличение на теглото със съгласие (%)">
                <input
                  min="0"
                  max="100"
                  type="number"
                  name="weightTolerance"
                  defaultValue={s.weightTolerance}
                />
              </Field>
              <Field title="Валидност на офертите според">
                <select name="promoBasis" defaultValue={s.promoBasis}>
                  <option value="delivery">Деня на доставката</option>
                  <option value="order">Деня на поръчката</option>
                </select>
              </Field>
              <Field title="Опити за връзка при липса">
                <input
                  type="number"
                  min="1"
                  max="10"
                  name="contactAttempts"
                  defaultValue={s.contactAttempts}
                />
              </Field>
              <Field title="Изчакване между опитите (мин)">
                <input
                  type="number"
                  min="1"
                  max="1440"
                  name="contactWaitMinutes"
                  defaultValue={s.contactWaitMinutes}
                />
              </Field>
            </div>
          </div>
        </Panel>
        <Panel title="Готовност за приемане на реални поръчки">
          <div className="adm-fields">
            {Object.entries(gates).map(([key, title]) => (
              <label className="adm-check" key={key}>
                <input type="checkbox" name={key} defaultChecked={s[key]} />
                {title}
              </label>
            ))}
          </div>
        </Panel>
        <Panel title="Известяване">
          <div className="adm-fields">
            <label className="adm-check">
              <input
                type="checkbox"
                name="notificationEmail"
                defaultChecked={Boolean(s.notificationEmail)}
              />
              Служебен имейл до магазина при получаване на нова поръчка
            </label>
            <label className="adm-check">
              <input
                type="checkbox"
                name="notificationSms"
                defaultChecked={s.notificationSms}
              />
              Оперативно SMS известяване при настроен доставчик
            </label>
          </div>
        </Panel>
        <Submit>Запази настройките</Submit>
      </CommandForm>
      <Panel title="Синоними за търсене">
        {synonyms.map((x) => (
          <p key={x.term}>
            <strong>{x.term}</strong> · {x.alternatives.join(", ")}
          </p>
        ))}
        <CommandForm command="synonym.save">
          <div className="adm-grid">
            <Field title="Търсена дума">
              <input name="term" required />
            </Field>
            <Field
              title="Синоними, отделени със запетая"
              hint="Остави празно за премахване на съществуваща група."
            >
              <input name="alternatives" />
            </Field>
          </div>
          <div className="adm-actions">
            <Submit>Запази синонимите</Submit>
          </div>
        </CommandForm>
      </Panel>
    </>
  );
}
