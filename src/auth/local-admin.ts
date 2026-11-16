export const localAdminId = "mikaela-local-admin";
export const localAdminEmail = "admin@localhost.invalid";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function localAdminConfigured() {
  try {
    const app = new URL(process.env.APP_URL || "");
    const db = new URL(process.env.DATABASE_URL || "");
    return loopback.has(app.hostname) && app.port === "3000" &&
      loopback.has(db.hostname) && db.pathname === "/mikaela" &&
      !db.searchParams.has("host") && !db.searchParams.has("hostaddr");
  } catch {
    return false;
  }
}

export function allowsLocalAdmin(headers?: Pick<Headers, "get">) {
  if (!headers || !localAdminConfigured()) return false;
  const localHosts = ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"];
  const host = headers.get("host")?.toLowerCase() || "";
  const forwardedHost = headers.get("x-forwarded-host")?.toLowerCase();
  const forwardedFor = headers.get("x-forwarded-for");
  return localHosts.includes(host) && (!forwardedHost || localHosts.includes(forwardedHost)) &&
    (!forwardedFor || forwardedFor.split(",").every((ip) =>
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip.trim().toLowerCase())));
}
