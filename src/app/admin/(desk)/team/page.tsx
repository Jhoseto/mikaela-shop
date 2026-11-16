import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { Field, CommandForm, Submit, PasswordInput } from "@/admin/widgets";
import { PageHeading, Panel } from "@/admin/presentation";
function Roles({ values = [] }: { values?: string[] }) {
  return (
    <div className="adm-inline">
      {Object.entries({
        owner: "Собственик",
        staff: "Служител",
        courier: "Доставчик",
      }).map(([role, title]) => (
        <label key={role} className="adm-check">
          <input
            type="checkbox"
            name="roles[]"
            value={role}
            defaultChecked={values.includes(role)}
          />
          {title}
        </label>
      ))}
    </div>
  );
}
export default async function Team() {
  await requireStaff(["owner"]);
  const users = await query(
    `select u.id,u.name,u.email,u."twoFactorEnabled" mfa,array_remove(array_agg(r.role),null) roles from "user" u left join staff_roles r on r.user_id=u.id group by u.id order by u.name`,
  );
  return (
    <>
      <PageHeading title="Служебни профили" />
      <Panel title="Създай профил">
        <CommandForm command="staff.create">
          <div className="adm-grid">
            <Field title="Име">
              <input name="name" required />
            </Field>
            <Field title="Имейл">
              <input name="email" type="email" required autoComplete="off" />
            </Field>
            <Field title="Начална парола (поне 12 знака)">
              <PasswordInput required />
            </Field>
          </div>
          <Roles />
          <div className="adm-actions">
            <Submit>Създай профил</Submit>
          </div>
        </CommandForm>
      </Panel>
      <Panel title="Права за достъп">
        {users.map((u) => (
          <details key={u.id} className="adm-details">
            <summary>
              {u.name} · {u.email}
            </summary>
            <p>Двуфакторна защита · {u.mfa ? "включена" : "неактивна"}</p>
            <CommandForm command="staff.roles">
              <input name="id" type="hidden" value={u.id} />
              <Roles values={u.roles} />
              <div className="adm-actions">
                <Submit secondary>Запази правата</Submit>
              </div>
            </CommandForm>
          </details>
        ))}
      </Panel>
    </>
  );
}
