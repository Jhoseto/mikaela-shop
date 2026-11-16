import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { Field, CommandForm, Submit } from "@/admin/widgets";
import { PageHeading, Panel, Empty } from "@/admin/presentation";
const weekdays = [
  "",
  "Понеделник",
  "Вторник",
  "Сряда",
  "Четвъртък",
  "Петък",
  "Събота",
  "Неделя",
];
const euros = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
function ZoneForm({ z }: { z: Record<string, any> }) {
  return (
    <CommandForm command="zone.save">
      <input type="hidden" name="id" value={z.id || ""} />
      <div className="adm-grid">
        <Field title="Населено място или район">
          <input name="name" defaultValue={z.name} required />
        </Field>
        <Field title="Минимална поръчка (€)">
          <input
            name="minimum"
            inputMode="decimal"
            required
            defaultValue={euros(z.min_cents ?? 0)}
          />
        </Field>
        <Field title="Цена за доставка (€)">
          <input
            name="fee"
            inputMode="decimal"
            required
            defaultValue={euros(z.fee_cents ?? 0)}
          />
        </Field>
        <Field
          title="Безплатна доставка при (€)"
          hint="Остави празно, ако няма такъв праг."
        >
          <input
            name="free"
            inputMode="decimal"
            defaultValue={euros(z.free_cents)}
          />
        </Field>
        <Field title="Подготовка (минути)">
          <input
            type="number"
            min="0"
            name="prep"
            defaultValue={z.prep_minutes ?? 0}
          />
        </Field>
        <Field title="Краен час за поръчки за същия ден">
          <input
            name="cutoff"
            type="time"
            defaultValue={z.cutoff?.slice(0, 5)}
          />
        </Field>
        <label className="adm-check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={z.active ?? true}
          />
          Обслужван район
        </label>
      </div>
      <div className="adm-actions">
        <Submit>Запази района</Submit>
      </div>
    </CommandForm>
  );
}
export default async function Delivery() {
  await requireStaff(["owner"]);
  const [zones, rules, exceptions] = await Promise.all([
    query("select * from delivery_zones order by name"),
    query("select * from delivery_rules order by weekday,start_time"),
    query(
      "select * from delivery_exceptions where day>=current_date order by day",
    ),
  ]);
  return (
    <>
      <PageHeading title="Райони и доставки" />
      <Panel title="Нов район">
        <ZoneForm z={{}} />
      </Panel>
      {zones.length === 0 && (
        <Empty>
          Добави район, за да настроиш тарифата и часовете за доставка.
        </Empty>
      )}
      {zones.map((z) => (
        <Panel title={z.name} key={z.id}>
          <details className="adm-details">
            <summary>Тарифа и условия</summary>
            <ZoneForm z={z} />
          </details>
          <h3>Работни интервали</h3>
          <ul className="adm-list">
            {rules
              .filter((r) => r.zone_id === z.id)
              .map((r) => (
                <li key={r.id}>
                  {weekdays[r.weekday]} · {r.start_time.slice(0, 5)}–
                  {r.end_time.slice(0, 5)} · {r.capacity} места
                </li>
              ))}
          </ul>
          <CommandForm command="delivery.rule">
            <input type="hidden" name="zone" value={z.id} />
            <div className="adm-grid">
              <Field title="Ден">
                <select name="weekday">
                  {weekdays.slice(1).map((w, i) => (
                    <option value={i + 1} key={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="Начало">
                <input name="start" type="time" required />
              </Field>
              <Field title="Край">
                <input name="end" type="time" required />
              </Field>
              <Field
                title="Максимален брой"
                hint="За спиране на интервал въведи 0."
              >
                <input name="capacity" type="number" min="0" required />
              </Field>
            </div>
            <div className="adm-actions">
              <Submit secondary>Запази интервала</Submit>
            </div>
          </CommandForm>
          <details className="adm-details">
            <summary>Празнични изключения</summary>
            <ul>
              {exceptions
                .filter((r) => r.zone_id === z.id)
                .map((r) => (
                  <li key={r.day}>
                    {r.day} · {r.closed ? "Почивен ден" : "По график"}
                  </li>
                ))}
            </ul>
            <CommandForm command="delivery.exception">
              <input name="zone" type="hidden" value={z.id} />
              <div className="adm-grid">
                <Field title="Дата">
                  <input name="day" type="date" required />
                </Field>
                <label className="adm-check">
                  <input type="checkbox" name="closed" defaultChecked />
                  Спри нови заявки за тази дата
                </label>
              </div>
              <div className="adm-actions">
                <Submit secondary>Запази изключението</Submit>
              </div>
            </CommandForm>
          </details>
        </Panel>
      ))}
    </>
  );
}
