import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { pool } from "@/db";
const appUrl = new URL(process.env.APP_URL || "http://localhost:3000");
export const auth = betterAuth({
  appName: "Моят Магазин Микаела",
  advanced: {
    cookiePrefix: appUrl.port ? "mikaela-" + appUrl.port : "mikaela",
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.APP_URL || "http://localhost:3000",
  database: pool,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 30 },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 90,
    customRules: { "/sign-in/email": { window: 120, max: 8 } },
  },
  plugins: [twoFactor({ issuer: "Моят Магазин Микаела" })],
});
