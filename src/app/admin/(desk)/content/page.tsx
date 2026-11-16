import { query } from "@/db";
import { requireStaff } from "@/auth/access";
import { getSettings } from "@/commerce/catalog";
import { pageTitles } from "@/admin/management-commands";
import { PageEditor } from "@/admin/page-editor";
import { PhotoEditor } from "@/admin/photo-editor";
import { PageHeading, Panel } from "@/admin/presentation";
import { Field, CommandForm, Submit } from "@/admin/widgets";
export default async function Content() {
  await requireStaff(["owner"]);
  const [pages, categories, products, settings] = await Promise.all([
    query("select * from pages"),
    query("select * from categories order by sort_order,name"),
    query("select id,name from products where status=$1 order by name", [
      "published",
    ]),
    getSettings(),
  ]);
  return (
    <>
      <PageHeading
        title="Съдържание"
        subtitle="Редактирай страниците и подредбата на магазина."
      />
      <Panel title="Страници и начална витрина">
        {Object.entries(pageTitles).map(([slug, title]) => {
          const p = pages.find((r) => r.slug === slug);
          const initial =
            p?.draft && Object.keys(p.draft).length
              ? p.draft
              : slug === "home"
                ? {
                    title: settings.hero.title,
                    body: settings.hero.subtitle,
                    image: settings.hero.image,
                    button: settings.hero.button,
                    featuredIds: settings.featuredIds,
                  }
                : { title };
          return (
            <details key={slug} className="adm-details">
              <summary>
                {title} ·{" "}
                {p?.published ? "публикувана версия " + p.version : "чернова"}
              </summary>
              <PageEditor
                slug={slug}
                revision={p?.updated_at?.toISOString() || ""}
                initial={initial}
                options={products}
              />
            </details>
          );
        })}
      </Panel>
      <Panel title="Категории">
        {[...categories, { id: "", name: "Нова категория" }].map((c) => (
          <details key={c.id} className="adm-details">
            <summary>{c.name}</summary>
            <CommandForm command="category.save">
              <input type="hidden" name="id" value={c.id} />
              <div className="adm-grid">
                <Field title="Име">
                  <input
                    name="name"
                    required
                    defaultValue={c.id ? c.name : ""}
                  />
                </Field>
                <Field title="Ред на показване">
                  <input
                    type="number"
                    min="0"
                    defaultValue={c.sort_order || 0}
                    name="sortOrder"
                  />
                </Field>
              </div>
              <PhotoEditor
                single
                name="image"
                initial={c.image_url ? [{ url: c.image_url }] : []}
              />
              <div className="adm-actions">
                <Submit>Запази категорията</Submit>
              </div>
            </CommandForm>
          </details>
        ))}
      </Panel>
    </>
  );
}
