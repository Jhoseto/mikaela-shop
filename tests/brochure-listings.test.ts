import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { currentBrochureListings } from "../src/importer/public-listings";

test("Само оригиналните предложения и снимки от активната редакция са публични", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const admin = new Client({ connectionString: url.href });
  const schema = "flyer_" + randomUUID().replaceAll("-", "");
  await admin.connect();
  await admin.query("CREATE SCHEMA " + schema);
  url.searchParams.set("options", "-c search_path=" + schema + ",public");
  process.env.DATABASE_URL = url.href;
  const { pool, query } = await import("../src/db");
  const { isPublishedMedia } = await import("../src/importer/visibility");
  const { getCurrentBrochure } = await import("../src/importer/public");
  try {
    assert.equal(
      (await query("SELECT current_schema() AS value"))[0].value,
      schema,
    );
    await pool.query(await readFile("migrations/001-core.sql", "utf8"));
    await pool.query(await readFile("src/importer/schema.sql", "utf8"));
    const [current] = await query(
      "INSERT INTO brochure_campaigns(starts,ends) SELECT d-2,d+2 FROM (SELECT (now() AT TIME ZONE 'Europe/Sofia')::date AS d) t RETURNING id",
    );
    const [future] = await query(
      "INSERT INTO brochure_campaigns(starts,ends) VALUES ((now() AT TIME ZONE 'Europe/Sofia')::date+3,(now() AT TIME ZONE 'Europe/Sofia')::date+6) RETURNING id",
    );
    const [expired] = await query(
      "INSERT INTO brochure_campaigns(starts,ends) VALUES ((now() AT TIME ZONE 'Europe/Sofia')::date-9,(now() AT TIME ZONE 'Europe/Sofia')::date-6) RETURNING id",
    );
    const [overlapping] = await query(
      "INSERT INTO brochure_campaigns(starts,ends) VALUES ((now() AT TIME ZONE 'Europe/Sofia')::date-4,(now() AT TIME ZONE 'Europe/Sofia')::date+1) RETURNING id",
    );
    async function addBatch(campaign: string, version: number, hash: string) {
      const [batch] = await query(
        "INSERT INTO brochure_batches(campaign_id,version,status,source_hash,source_url,finished_at,original_url) VALUES ($1,$2,'success',$3,'fixture',now(),'/media/brochures/' || $3 || '/original.pdf') RETURNING id",
        [campaign, version, hash],
      );
      await query(
        "UPDATE brochure_campaigns SET current_batch=$2 WHERE id=$1",
        [campaign, batch.id],
      );
      return batch.id as string;
    }
    const originalHash = "a".repeat(64),
      correctionHash = "b".repeat(64);
    const oldBatch = await addBatch(current.id, 1, originalHash);
    const batch = await addBatch(current.id, 2, correctionHash);
    const futureBatch = await addBatch(future.id, 1, "c".repeat(64));
    const expiredBatch = await addBatch(expired.id, 1, "d".repeat(64));
    await addBatch(overlapping.id, 1, "e".repeat(64));
    async function addItem(
      batchId: string,
      hash: string,
      name: string,
      ordinal: number,
    ) {
      const key = randomUUID();
      const [product] = await query(
        "INSERT INTO products(slug,name,origin,status,description,food,source_data) VALUES ($1,'Непубликувано име','brochure','draft','Частна бележка',$2,$3) RETURNING id",
        [
          key,
          { private: "lexicon" },
          { source_key: key, food: { ageRestricted: true } },
        ],
      );
      const [variant] = await query(
        "INSERT INTO variants(product_id,name,pack) VALUES ($1,'Частен вариант','100 г') RETURNING id",
        [product.id],
      );
      await query(
        "INSERT INTO brochure_sources(source_key,draft_variant) VALUES ($1,$2)",
        [key, variant.id],
      );
      const imageUrl =
        "/media/brochures/" + hash + "/v3/p1-i" + ordinal + "-photo.webp";
      const extracted = {
        name,
        brand: "Бранд",
        text: name,
        pack: "100 г",
        unit: "piece",
        priceCents: 123,
        buy: 2,
        pay: 1,
        terms: "Вземи 2, плати 1",
        localOnly: true,
        imageUrl,
      };
      await query(
        "INSERT INTO brochure_items(batch_id,source_key,page,ordinal,extracted,status) VALUES ($1,$2,1,$3,$4,'review')",
        [batchId, key, ordinal, extracted],
      );
      return {
        key,
        productId: product.id,
        variantId: variant.id,
        imageUrl,
        extracted,
      };
    }
    const shown = await addItem(batch, correctionHash, "Официално име", 1);
    const old = await addItem(oldBatch, originalHash, "Предишна редакция", 1);
    const upcoming = await addItem(
      futureBatch,
      "c".repeat(64),
      "Предстояща",
      1,
    );
    const past = await addItem(expiredBatch, "d".repeat(64), "Изтекла", 1);
    const hidden = await addItem(batch, correctionHash, "Скрита", 2);
    const archived = await addItem(batch, correctionHash, "Архивирана", 3);
    const excluded = await addItem(batch, correctionHash, "Изключена", 4);
    const linked = await addItem(
      batch,
      correctionHash,
      "Потвърдено съпоставяне",
      5,
    );
    await query("UPDATE products SET status='hidden' WHERE id=$1", [
      hidden.productId,
    ]);
    await query("UPDATE products SET status='archived' WHERE id=$1", [
      archived.productId,
    ]);
    await query(
      "UPDATE brochure_sources SET excluded=true WHERE source_key=$1",
      [excluded.key],
    );
    await query(
      "INSERT INTO brochure_links(source_key,variant_id,confirmed_by,price_cents,buy,pay) VALUES($1,$2,'test',123,2,1)",
      [linked.key, linked.variantId],
    );
    await query(
      "INSERT INTO brochure_items(batch_id,source_key,page,ordinal,extracted,status) VALUES ($1,$2,2,1,$3,'review')",
      [batch, shown.key, shown.extracted],
    );
    const privateUpload = "/media/uploads/" + randomUUID() + ".webp";
    await query(
      "INSERT INTO images(product_id,url,source) VALUES($1,$2,'local')",
      [shown.productId, privateUpload],
    );
    const rows = await query(currentBrochureListings);
    assert.equal(rows.length, 1);
    const offer = rows[0];
    assert.equal(offer.variant_id, shown.variantId);
    assert.equal(offer.name, "Официално име");
    assert.equal(offer.description, "Официално име");
    assert.equal(offer.category_id, null);
    assert.equal(offer.age_restricted, true);
    assert.equal(offer.price_cents, 123);
    assert.equal(offer.terms, "Вземи 2, плати 1 · Само в определени обекти.");
    assert.equal(offer.image_url, shown.imageUrl);
    const media = (url: string) =>
      isPublishedMedia(url.replace(/^\/media\//, ""));
    const brochure = await getCurrentBrochure();
    assert.equal(brochure?.id, current.id);
    assert.equal(await media(brochure!.pdfUrl), true);
    assert.equal(await media("/media/brochures/" + "e".repeat(64) + "/original.pdf"), false);
    assert.equal(await media(shown.imageUrl), true);
    assert.equal(
      await media(shown.imageUrl.replace("-photo.webp", "-photo-card.webp")),
      true,
    );
    for (const url of [
      privateUpload,
      shown.imageUrl.replace("-photo.webp", "-source.webp"),
      ...[old, upcoming, past, hidden, archived, excluded, linked].map(
        (item) => item.imageUrl,
      ),
    ]) {
      assert.equal(await media(url), false, url);
    }
  } finally {
    await pool.end();
    await admin.query("DROP SCHEMA " + schema + " CASCADE");
    await admin.end();
  }
});
