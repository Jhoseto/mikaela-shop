"use client";
export function CourierLogout() {
  return (
    <button
      className="adm-btn alt"
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
  );
}
