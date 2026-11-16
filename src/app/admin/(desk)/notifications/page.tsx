import Link from "next/link";
import { query } from "@/db";
import { requireStaff } from "@/auth/access";
import { PageHeading, Panel, Empty } from "@/admin/presentation";
import { CommandForm, Submit } from "@/admin/widgets";
import { dateTime, label } from "@/admin/format";
export default async function NotificationsPage() {
  await requireStaff(["staff"]);
  const jobs =
    await query(`select j.id,j.kind,j.channel,j.status,j.attempts,j.next_at,j.last_error,o.id order_id,o.number
 from notification_jobs j left join orders o on o.id=j.order_id
 where j.status in ('failed','retry') order by j.next_at desc limit 150`);
  return (
    <>
      <PageHeading title="Проблеми с известяването" />
      <Panel>
        {jobs.length ? (
          <ul className="adm-list">
            {jobs.map((j) => (
              <li key={j.id}>
                <strong>
                  {label(j.kind)} · {j.channel === "sms" ? "SMS" : "Имейл"}
                </strong>
                {j.order_id && (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      className="adm-link"
                      href={"/admin/orders/" + j.order_id}
                    >
                      Поръчка № {j.number}
                    </Link>
                  </>
                )}
                <p>
                  {j.last_error} · Опити за изпращане · {j.attempts}
                  {j.status === "retry"
                    ? " · Следващ опит " + dateTime(j.next_at)
                    : ""}
                </p>
                <CommandForm command="notification.retry">
                  <input name="id" type="hidden" value={j.id} />
                  <Submit secondary>Опитай отново</Submit>
                </CommandForm>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Няма неуспешни известия за обработване.</Empty>
        )}
      </Panel>
    </>
  );
}
