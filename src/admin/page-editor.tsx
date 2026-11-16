"use client";
import { useState } from "react";
import { PhotoEditor, type Photo } from "./photo-editor";
import { Field, CommandForm, Submit } from "./widgets";
export function PageEditor({
  slug,
  initial,
  revision,
  options,
}: {
  slug: string;
  initial: Record<string, any>;
  revision: string;
  options: { id: string; name: string }[];
}) {
  const [title, setTitle] = useState<string>(initial.title || ""),
    [body, setBody] = useState<string>(initial.body || ""),
    [preview, setPreview] = useState(false);
  const [button, setButton] = useState<string>(
    initial.button || "Започни да пазаруваш",
  );
  const [photos, setPhotos] = useState<Photo[]>(
    initial.image ? [{ url: initial.image }] : [],
  );
  const [featured, setFeatured] = useState<string[]>(initial.featuredIds || []);
  return (
    <CommandForm command="page.save">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revision" value={revision} />
      <div className="adm-fields">
        <Field title="Заглавие">
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={150}
          />
        </Field>
        <Field title={slug === "home" ? "Текст на банера" : "Съдържание"}>
          <textarea
            name="body"
            rows={slug === "home" ? 3 : 10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <div>
          <strong>Снимка</strong>
          <PhotoEditor
            single
            name="image"
            initial={initial.image ? [{ url: initial.image }] : []}
            onChange={setPhotos}
          />
        </div>
        {slug === "home" && (
          <>
            <Field title="Текст на бутона">
              <input
                name="button"
                value={button}
                onChange={(e) => setButton(e.target.value)}
                required
              />
            </Field>
            <details className="adm-details">
              <summary>Подбрани продукти</summary>
              <div className="adm-grid">
                {options.map((p) => (
                  <label className="adm-check" key={p.id}>
                    <input
                      type="checkbox"
                      name="featured[]"
                      value={p.id}
                      checked={featured.includes(p.id)}
                      onChange={(e) =>
                        setFeatured(
                          e.target.checked
                            ? [...featured, p.id]
                            : featured.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </details>
          </>
        )}
        <button
          type="button"
          className="adm-btn alt"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Затвори прегледа" : "Предварителен преглед"}
        </button>
      </div>
      {preview && (
        <article
          style={{
            padding: "20px",
            background: "#f7f8f2",
            borderRadius: 12,
            marginTop: 14,
          }}
        >
          {photos.length > 0 && (
            <img
              src={photos[0].url}
              alt=""
              style={{
                maxHeight: 240,
                borderRadius: 12,
                marginBottom: 16,
                objectFit: "contain",
              }}
            />
          )}
          <h2>{title}</h2>
          {body.split(/\n\s*\n/).map((s, i) => (
            <p style={{ whiteSpace: "pre-line" }} key={i}>
              {s}
            </p>
          ))}
          {slug === "home" && (
            <>
              <span
                className="adm-btn"
                style={{
                  background: "#ff7a1a",
                  color: "#173d2a",
                  pointerEvents: "none",
                }}
              >
                {button}
              </span>
              {featured.length > 0 && (
                <div>
                  <h3 style={{ marginTop: 16 }}>Подбрани продукти</h3>
                  <ul>
                    {featured.map((id) => (
                      <li key={id}>{options.find((p) => p.id === id)?.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </article>
      )}
      <div className="adm-actions">
        <Submit secondary name="operation" value="draft">
          Запази чернова
        </Submit>
        <Submit name="operation" value="publish">
          Публикувай
        </Submit>
      </div>
    </CommandForm>
  );
}
