"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const links = [
  ["/admin", "Табло"],
  ["/admin/orders", "Поръчки"],
  ["/admin/products", "Продукти"],
  ["/admin/broshuri", "Брошури"],
  ["/admin/offers", "Промоции"],
  ["/admin/content", "Съдържание"],
  ["/admin/delivery", "Доставка"],
  ["/admin/settings", "Настройки"],
  ["/admin/team", "Екип"],
  ["/admin/audit", "История"],
];
const ownerOnly = [
  "/admin/content",
  "/admin/settings",
  "/admin/delivery",
  "/admin/team",
  "/admin/audit",
];
export function Shell({
  name,
  roles,
  children,
}: {
  name: string;
  roles: string[];
  children: ReactNode;
}) {
  const path = usePathname();
  return (
    <div className="adm-shell">
      <aside className="adm-nav">
        <Link href="/admin" className="adm-brand">
          Микаела<span>Работно място</span>
        </Link>
        <nav aria-label="Служебно меню">
          {links
            .filter(
              ([url]) => roles.includes("owner") || !ownerOnly.includes(url),
            )
            .map(([url, title]) => (
              <Link
                href={url}
                key={url}
                aria-current={
                  (url === "/admin" ? path === url : path.startsWith(url))
                    ? "page"
                    : undefined
                }
              >
                {title}
              </Link>
            ))}
          {(roles.includes("owner") || roles.includes("courier")) && (
            <Link href="/dostavchik">Моите доставки</Link>
          )}
          <Link href="/">Към магазина ↗</Link>
          <button
            type="button"
            onClick={async () => {
              const r = await fetch("/api/auth/sign-out", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}",
              });
              if (r.ok) location.assign("/admin/login");
            }}
          >
            Изход
          </button>
        </nav>
        <div className="adm-navfooter">{name}</div>
      </aside>
      <main className="adm-main">{children}</main>
    </div>
  );
}
