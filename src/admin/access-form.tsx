"use client";
import { useState, type FormEvent } from "react";
import { Field } from "./widgets";

export function AccessForm({ mode }: { mode: "login" | "enroll" | "verify" }) {
  const [setup, setSetup] = useState<{
    secret: string;
    codes: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backup, setBackup] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const d = new FormData(e.currentTarget);
    const path =
      mode === "login"
        ? "sign-in/email"
        : mode === "enroll" && !setup
          ? "two-factor/enable"
          : backup
            ? "two-factor/verify-backup-code"
            : "two-factor/verify-totp";
    const payload =
      mode === "login"
        ? { email: d.get("email"), password: d.get("password") }
        : mode === "enroll" && !setup
          ? { password: d.get("password") }
          : { code: d.get("code") };
    try {
      const res = await fetch("/api/auth/" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(
          res.status === 429
            ? "Твърде много опити. Изчакай и опитай отново."
            : mode === "login"
              ? "Провери имейла и паролата."
              : "Провери паролата или въведения код.",
        );
      if (path === "two-factor/enable") {
        const secret = new URL(result.totpURI).searchParams.get("secret");
        if (!secret) throw new Error("Неуспешно създаване на ключ.");
        setSetup({ secret, codes: result.backupCodes });
        return;
      }
      location.replace(result.twoFactorRedirect ? "/admin/2fa" : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неуспешно свързване.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      style={{ maxWidth: 500, margin: "0 auto", padding: "12vh 16px 32px" }}
    >
      <div className="adm-panel">
        <p className="adm-caption">Моят Магазин Микаела</p>
        <h1>
          {mode === "login"
            ? "Служебен вход"
            : mode === "enroll"
              ? "Защити служебния си профил"
              : "Потвърди входа"}
        </h1>
        <form className="adm-fields" onSubmit={submit}>
          {mode === "login" && (
            <Field title="Служебен имейл">
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
              />
            </Field>
          )}
          {(mode === "login" || (mode === "enroll" && !setup)) && (
            <Field title="Парола">
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </Field>
          )}
          {setup && (
            <section>
              <p>Добави този ключ към приложение за двуфакторна защита.</p>
              <code style={{ overflowWrap: "anywhere" }}>{setup.secret}</code>
              <details className="adm-details">
                <summary>Резервни кодове за достъп</summary>
                <p>Прибери копие на сигурно място.</p>
                <pre>{setup.codes.join("\n")}</pre>
              </details>
            </section>
          )}
          {(mode === "verify" || setup) && (
            <Field title={backup ? "Резервен код" : "Шестцифрен код"}>
              <input
                name="code"
                autoComplete="one-time-code"
                inputMode={backup ? "text" : "numeric"}
                pattern={backup ? undefined : "[0-9]{6}"}
                required
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="adm-error">
              {error}
            </p>
          )}
          <button className="adm-btn" disabled={busy}>
            {busy
              ? "Изчакване…"
              : mode === "login"
                ? "Влез"
                : mode === "enroll" && !setup
                  ? "Свържи приложение"
                  : "Потвърди"}
          </button>
          {mode === "verify" && (
            <button
              type="button"
              className="adm-btn alt"
              onClick={() => setBackup(!backup)}
            >
              {backup ? "Код от приложение" : "Използвай резервен код"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
