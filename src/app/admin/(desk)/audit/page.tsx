import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { PageHeading, Panel, Empty } from "@/admin/presentation";
import { dateTime } from "@/admin/format";
export default async function Audit() {
  await requireStaff(["owner"]);
  const rows = await query(
    'select a.*,u.name from audit_log a left join "user" u on u.id=a.actor order by a.id desc limit 250',
  );
  return (
    <>
      <PageHeading title="История на действията" />
      <Panel>
        {rows.length ? (
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Време</th>
                  <th>Служител</th>
                  <th>Действие</th>
                  <th>Запис</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.created_at)}</td>
                    <td>{r.name || "Система"}</td>
                    <td>{r.detail?.label || r.action}</td>
                    <td>{r.entity || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Няма регистрирани действия.</Empty>
        )}
      </Panel>
    </>
  );
}
