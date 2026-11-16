import assert from "node:assert/strict";
import test from "node:test";
import { allowsLocalAdmin } from "../src/auth/local-admin";

test("local admin is limited to the local shop and database", (t) => {
  const previousApp = process.env.APP_URL;
  const previousDb = process.env.DATABASE_URL;
  t.after(() => {
    if (previousApp === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousApp;
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  });

  process.env.APP_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://127.0.0.1:55440/mikaela";
  const local = new Headers({ host: "localhost:3000" });
  assert.equal(allowsLocalAdmin(local), true);
  assert.equal(allowsLocalAdmin(new Headers({
    host: "[::1]:3000", "x-forwarded-host": "[::1]:3000", "x-forwarded-for": "::1",
  })), true);
  assert.equal(allowsLocalAdmin(), false);
  const externalRequests: Record<string, string>[] = [
    { host: "shop.example:3000" },
    { host: "localhost:3100" },
    { host: "localhost:3000", "x-forwarded-host": "shop.example" },
    { host: "localhost:3000", "x-forwarded-for": "192.0.2.10, 127.0.0.1" },
  ];
  for (const headers of externalRequests) {
    assert.equal(allowsLocalAdmin(new Headers(headers)), false);
  }

  process.env.APP_URL = "https://shop.example:3000";
  assert.equal(allowsLocalAdmin(local), false);
  process.env.APP_URL = "http://localhost:3000";
  for (const database of [
    "postgresql://db.example/mikaela",
    "postgresql://localhost/mikaela_demo",
    "postgresql://localhost/mikaela?host=db.example",
    "postgresql://localhost/mikaela?hostaddr=192.0.2.10",
  ]) {
    process.env.DATABASE_URL = database;
    assert.equal(allowsLocalAdmin(local), false);
  }
});
