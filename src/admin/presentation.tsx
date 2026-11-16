import Link from "next/link";
import type { ReactNode } from "react";
import { label } from "./format";

export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="adm-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export function Panel({
  title,
  children,
  id,
}: {
  title?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="adm-panel" id={id}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Pill({ value }: { value: string }) {
  return <span className={"adm-pill s-" + value}>{label(value)}</span>;
}
export function Open({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="adm-btn" href={href}>
      {children}
    </Link>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="adm-empty">{children}</div>;
}
