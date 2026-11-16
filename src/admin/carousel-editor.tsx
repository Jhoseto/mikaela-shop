"use client";

import { ArrowLeft, ArrowRight, EyeOff, Plus, Trash2 } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import type {
  CarouselConfig,
  CarouselProductOption,
  CarouselSlide,
} from "@/commerce/carousel";
import { PhotoEditor, type Photo } from "./photo-editor";
import { defaultCarousel } from "@/commerce/carousel";
import { Field, sendCommand } from "./widgets";
import "./carousel-editor.css";

const themes: Record<CarouselSlide["theme"], string> = {
  table: "Кремаво",
  citrus: "Цитрус",
  market: "Зелено",
  coffee: "Кафе",
  dessert: "Розово",
};

function headline(slide: CarouselSlide, product?: CarouselProductOption) {
  return (
    slide.title.trim() ||
    (slide.kind === "product" && product?.name) ||
    "Нов слайд"
  );
}

function SlidePreview({
  slide,
  product,
}: {
  slide: CarouselSlide;
  product?: CarouselProductOption;
}) {
  const linked = slide.kind === "product" ? product : undefined;
  const image = slide.image || linked?.image;
  return (
    <figure
      className="carousel-preview"
      data-theme={slide.theme}
      aria-label="Преглед на избрания слайд"
    >
      <div className="carousel-preview-copy">
        <strong>
          {headline(slide, linked)}
          {slide.accent && (
            <>
              {" "}
              <em>{slide.accent}</em>
            </>
          )}
        </strong>
        {(slide.detail || linked?.name) && (
          <p>{slide.detail || linked?.name}</p>
        )}
        <span>
          {slide.button || (slide.kind === "product" ? "Виж продукта" : "Виж повече")}{" "}
          <ArrowRight size={13} aria-hidden />
        </span>
      </div>
      <div
        className={"carousel-preview-art" + (slide.image ? " has-scene" : "")}
      >
        {image && <img src={image} alt={slide.imageAlt || ""} />}
        {linked?.price && <b>{linked.price}</b>}
      </div>
    </figure>
  );
}

type ChangeSlide = (id: string, changes: Partial<CarouselSlide>) => void;

function SlideFields({
  slide,
  products,
  update,
}: {
  slide: CarouselSlide;
  products: CarouselProductOption[];
  update: ChangeSlide;
}) {
  const linked = slide.kind === "product";
  const product = products.find((p) => p.id === slide.productId);
  const setPhoto = useCallback(
    (photos: Photo[]) => {
      update(slide.id, { image: photos[0]?.url || "" });
    },
    [slide.id, update],
  );
  function set(field: keyof CarouselSlide, value: string | boolean) {
    update(slide.id, { [field]: value });
  }
  return (
    <div className="carousel-edit-fields">
      <div className="adm-grid">
        <Field title="Тип на слайда">
          <select
            value={slide.kind}
            onChange={(e) => set("kind", e.target.value)}
          >
            <option value="product">Продукт от каталога</option>
            <option value="custom">Свободен банер</option>
          </select>
        </Field>
        <Field title="Цветова тема">
          <select
            value={slide.theme}
            onChange={(e) => set("theme", e.target.value)}
          >
            {Object.entries(themes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {linked && (
        <Field title="Продукт">
          <select
            value={slide.productId}
            onChange={(e) => set("productId", e.target.value)}
          >
            <option value="">Избери продукт</option>
            {slide.productId && !product && (
              <option value={slide.productId}>Недостъпен продукт</option>
            )}
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="adm-grid">
        <Field title="Заглавие">
          <input
            value={slide.title}
            maxLength={150}
            placeholder={
              linked ? product?.name || "Име на продукта" : undefined
            }
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
        <Field title="Акцент в курсив">
          <input
            value={slide.accent}
            maxLength={100}
            onChange={(e) => set("accent", e.target.value)}
          />
        </Field>
      </div>
      <Field title="Кратко описание">
        <textarea
          rows={2}
          value={slide.detail}
          maxLength={600}
          onChange={(e) => set("detail", e.target.value)}
        />
      </Field>
      <div className="adm-grid">
        <Field title="Текст на бутона">
          <input
            value={slide.button}
            maxLength={70}
            placeholder={linked ? "Виж продукта" : "Виж повече"}
            onChange={(e) => set("button", e.target.value)}
          />
        </Field>
        {!linked && (
          <Field
            title="Връзка"
          >
            <input
              value={slide.href}
              maxLength={1000}
              placeholder="/broshura"
              onChange={(e) => set("href", e.target.value)}
            />
          </Field>
        )}
      </div>
      <details className="adm-details carousel-image-fields">
        <summary>{slide.image ? "Смени снимката" : "Добави снимка"}</summary>
        <PhotoEditor
          single
          name="slideImage"
          initial={slide.image ? [{ url: slide.image }] : []}
          onChange={setPhoto}
        />
        {slide.image && (
          <Field
            title="Описание на снимката"
          >
            <input
              value={slide.imageAlt}
              maxLength={250}
              onChange={(e) => set("imageAlt", e.target.value)}
            />
          </Field>
        )}
      </details>
    </div>
  );
}

export function CarouselEditor({
  initial,
  revision,
  version,
  products,
  automatic,
}: {
  initial: CarouselConfig;
  revision: number;
  version: number;
  products: CarouselProductOption[];
  automatic: CarouselSlide[];
}) {
  const [config, setConfig] = useState(initial);
  const [activeId, setActiveId] = useState("");
  const [seedManual, setSeedManual] = useState(
    initial.mode === "auto" && initial.slides.length === 0,
  );
  const [savedRevision, setSavedRevision] = useState(revision);
  const [publishedVersion, setPublishedVersion] = useState(version);
  const [savedConfig, setSavedConfig] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const manual = config.mode === "manual";
  const slides = manual ? config.slides : automatic;
  const active = slides.find((slide) => slide.id === activeId) || slides[0];
  const position = slides.findIndex((slide) => slide.id === active?.id);
  const activeProduct = products.find((p) => p.id === active?.productId);
  const dirty = savedConfig !== JSON.stringify(config);
  const update = useCallback<ChangeSlide>((id, changes) => {
    setConfig((before) => {
      const current = before.slides.find((slide) => slide.id === id);
      if (
        !current ||
        !Object.entries(changes).some(
          ([key, value]) => current[key as keyof CarouselSlide] !== value,
        )
      )
        return before;
      return {
        ...before,
        slides: before.slides.map((slide) =>
          slide.id === id ? { ...slide, ...changes } : slide,
        ),
      };
    });
  }, []);
  function chooseMode(mode: CarouselConfig["mode"]) {
    if (mode === "manual" && seedManual) {
      const copies = automatic.map((slide) => ({ ...slide }));
      setSeedManual(false);
      setConfig({ ...config, mode, slides: copies });
      setActiveId(copies[0]?.id || "");
    } else {
      setConfig({ ...config, mode });
      setActiveId("");
    }
  }
  function addSlide() {
    if (slides.length >= 5) return;
    const slide: CarouselSlide = {
      id: crypto.randomUUID(),
      kind: products.length ? "product" : "custom",
      enabled: true,
      productId: "",
      title: "",
      accent: "",
      detail: "",
      image: "",
      imageAlt: "",
      button: "",
      href: "/produkti",
      theme: "table",
    };
    setConfig({ ...config, slides: [...slides, slide] });
    setActiveId(slide.id);
  }
  function moveSlide(offset: number) {
    const moved = [...slides];
    const target = position + offset;
    if (position < 0 || target < 0 || target >= moved.length) return;
    [moved[target], moved[position]] = [moved[position], moved[target]];
    setActiveId(moved[target].id);
    setConfig({ ...config, slides: moved });
  }
  function removeSlide() {
    const remaining = slides.filter((slide) => slide.id !== active.id);
    setConfig({ ...config, slides: remaining });
    setActiveId((remaining[position] || remaining[position - 1])?.id || "");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const button = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const operation = button?.value === "publish" ? "publish" : "save";
    setBusy(true);
    setNotice("");
    setFailed(false);
    try {
      const result = await sendCommand("page.carousel", {
        config: JSON.stringify(config),
        revision: String(savedRevision),
        operation,
      });
      if (typeof result.revision === "number")
        setSavedRevision(result.revision);
      if (typeof result.version === "number")
        setPublishedVersion(result.version);
      setSavedConfig(JSON.stringify(config));
      setNotice(
        result.message ||
          (operation === "publish"
            ? "Каруселът е публикуван."
            : "Черновата е запазена."),
      );
    } catch (e) {
      setFailed(true);
      setNotice(e instanceof Error ? e.message : "Промените не са записани.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="adm-form carousel-editor" onSubmit={save} aria-busy={busy}>
      <fieldset className="adm-plain" disabled={busy}>
        <fieldset className="carousel-mode">
          <legend>Подбор на слайдове</legend>
          <label>
            <input
              type="radio"
              name="carousel-mode"
              value="auto"
              checked={!manual}
              onChange={() => chooseMode("auto")}
            />{" "}
            От брошурата
          </label>
          <label>
            <input
              type="radio"
              name="carousel-mode"
              value="manual"
              checked={manual}
              onChange={() => chooseMode("manual")}
            />{" "}
            Ръчен подбор
          </label>
        </fieldset>
        {slides.length > 0 && (
          <div
            className="carousel-slide-list"
            role="group"
            aria-label="Слайдове"
          >
            {slides.map((slide, i) => {
              const p = products.find((item) => item.id === slide.productId);
              const title = headline(slide, p);
              const thumb =
                slide.image || (slide.kind === "product" && p?.image);
              return (
                <button
                  type="button"
                  key={slide.id}
                  aria-pressed={slide.id === active?.id}
                  aria-label={`Слайд ${i + 1} · ${title}${!slide.enabled ? " · скрит" : ""}`}
                  onClick={() => setActiveId(slide.id)}
                  data-theme={slide.theme}
                >
                  <span className="carousel-thumb">
                    {thumb && <img src={thumb} alt="" />}
                    <b>{i + 1}</b>
                  </span>
                  <span className="carousel-slide-name">
                    {!slide.enabled && <EyeOff size={14} aria-hidden />}
                    {title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {manual && (
          <div className="carousel-tools">
            <button
              type="button"
              className="adm-btn alt"
              disabled={slides.length >= 5}
              onClick={addSlide}
            >
              <Plus size={16} /> Добави слайд
            </button>
            {active && (
              <>
                <button
                  type="button"
                  className="adm-btn alt"
                  title="Премести наляво"
                  aria-label="Премести наляво"
                  onClick={() => moveSlide(-1)}
                  disabled={position <= 0}
                >
                  <ArrowLeft size={17} />
                </button>
                <button
                  type="button"
                  className="adm-btn alt"
                  title="Премести надясно"
                  aria-label="Премести надясно"
                  onClick={() => moveSlide(1)}
                  disabled={position >= slides.length - 1}
                >
                  <ArrowRight size={17} />
                </button>
                <button
                  type="button"
                  className="adm-btn alt carousel-remove"
                  title="Премахни слайд"
                  aria-label="Премахни слайд"
                  onClick={removeSlide}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        )}
        {manual && !slides.some((slide) => slide.enabled) && (
          <p className="adm-caption">
            При публикуване началната страница ще се показва без карусел.
          </p>
        )}
        {active && (
          <div className={"carousel-workspace" + (!manual ? " automatic" : "")}>
            <div>
              <SlidePreview slide={active} product={activeProduct} />
              {manual && (
                <label className="adm-check carousel-enabled">
                  <input
                    type="checkbox"
                    checked={active.enabled}
                    onChange={(e) =>
                      update(active.id, { enabled: e.target.checked })
                    }
                  />{" "}
                  Показвай слайда
                </label>
              )}
            </div>
            {manual && (
              <SlideFields
                key={active.id}
                slide={active}
                products={products}
                update={update}
              />
            )}
          </div>
        )}
        <div className="carousel-playback">
          <label className="adm-check">
            <input
              type="checkbox"
              checked={config.autoPlay}
              onChange={(e) =>
                setConfig({
                  ...config,
                  autoPlay: e.target.checked,
                  intervalMs: Math.min(
                    20000,
                    Math.max(3000, config.intervalMs || defaultCarousel.intervalMs),
                  ),
                })
              }
            />{" "}
            Автоматична смяна
          </label>
          <Field title="Време на слайд (секунди)">
            <input
              type="number"
              min="3"
              max="20"
              step="0.1"
              value={config.intervalMs / 1000 || ""}
              disabled={!config.autoPlay}
              onChange={(e) =>
                setConfig({
                  ...config,
                  intervalMs: Math.round(Number(e.target.value) * 1000),
                })
              }
            />
          </Field>
        </div>
        <div className="adm-actions carousel-save">
          <button className="adm-btn alt" type="submit" value="save">
            Запази чернова
          </button>
          <button className="adm-btn" type="submit" value="publish">
            Публикувай карусела
          </button>
          {dirty && <span className="adm-caption">Незапазени промени</span>}
          {publishedVersion > 0 && (
            <span className="adm-caption">
              Публикувана версия {publishedVersion}
            </span>
          )}
        </div>
      </fieldset>
      {notice && (failed || !dirty) && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "adm-error" : "adm-success"}
        >
          {notice}
        </p>
      )}
    </form>
  );
}
