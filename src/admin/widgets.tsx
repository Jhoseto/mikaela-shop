"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";

export type FormValues = Record<string, unknown>;

export async function sendCommand(command: string, data: FormValues) {
  const response = await fetch("/api/admin/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, data }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Промяната не е записана. Опитай отново.");
  return result as {
    href?: string;
    message?: string;
    revision?: number;
    version?: number;
  };
}

export function CommandForm({
  command,
  children,
  className = "",
  after,
  confirm,
}: {
  command: string;
  children: ReactNode;
  className?: string;
  after?: string;
  confirm?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || (confirm && !window.confirm(confirm))) return;
    const form = e.currentTarget;
    const trigger = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const values = new FormData(form);
    if (trigger?.name) values.set(trigger.name, trigger.value);
    const data: FormValues = {};
    for (const key of new Set(values.keys())) {
      const list = values.getAll(key).map(String);
      data[key] = key.endsWith("[]") ? list : list[0];
    }
    setBusy(true);
    setNotice("");
    setFailed(false);
    try {
      const result = await sendCommand(command, data);
      setNotice(result.message || "Промените са записани.");
      if (result.href || after) router.push(result.href || after!);
      router.refresh();
    } catch (err) {
      setFailed(true);
      setNotice(err instanceof Error ? err.message : "Възникна грешка.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={"adm-form " + className}
      onSubmit={handleSubmit}
      aria-busy={busy}
    >
      <fieldset disabled={busy} className="adm-plain">
        {children}
      </fieldset>
      {notice && (
        <p
          className={failed ? "adm-error" : "adm-success"}
          role={failed ? "alert" : "status"}
        >
          {notice}
        </p>
      )}
    </form>
  );
}

export function Field({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const native =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["select", "input", "textarea"].includes(children.type);
  const control = native
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-labelledby": id + "-title",
        "aria-describedby": hint ? id + "-hint" : undefined,
      })
    : children;
  return (
    <label className="adm-field">
      <span id={id + "-title"}>{title}</span>
      {control}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </label>
  );
}

export function Submit({
  children,
  name,
  value,
  secondary = false,
}: {
  children: ReactNode;
  name?: string;
  value?: string;
  secondary?: boolean;
}) {
  return (
    <button
      className={secondary ? "adm-btn alt" : "adm-btn"}
      type="submit"
      name={name}
      value={value}
    >
      {children}
    </button>
  );
}

export function PrintButton({ text = "Печат" }: { text?: string }) {
  return (
    <button
      type="button"
      className="adm-btn alt no-print"
      onClick={() => window.print()}
    >
      {text}
    </button>
  );
}

export function PasswordInput({
  name = "password",
  required = false,
}: {
  name?: string;
  required?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="adm-inline">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        minLength={12}
        required={required}
        autoComplete="new-password"
      />
      <button
        type="button"
        className="adm-btn alt"
        onClick={() => setShow(!show)}
      >
        {show ? "Скрий" : "Покажи"}
      </button>
    </div>
  );
}
