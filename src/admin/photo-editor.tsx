"use client";
import { useEffect, useRef, useState } from "react";
export type Photo = { url: string; thumb?: string; alt?: string };
const clearSides = { left: 0, top: 0, right: 0, bottom: 0 };
const sideTitles = {
  left: "Отляво",
  top: "Отгоре",
  right: "Отдясно",
  bottom: "Отдолу",
};
export function PhotoEditor({
  name,
  initial = [],
  single = false,
  onChange,
}: {
  name: string;
  initial?: Photo[];
  single?: boolean;
  onChange?: (photos: Photo[]) => void;
}) {
  const [photos, setPhotos] = useState(initial),
    [file, setFile] = useState<File | null>(null),
    [src, setSrc] = useState("");
  const [angle, setAngle] = useState(0),
    [sides, setSides] = useState(clearSides),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    [previewOk, setPreviewOk] = useState(false);
  const camera = useRef<HTMLInputElement>(null),
    gallery = useRef<HTMLInputElement>(null),
    upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onChange?.(photos);
  }, [photos, onChange]);
  useEffect(() => {
    let stop = false;
    let objectUrl = "";
    if (!file) {
      setSrc("");
      return;
    }
    objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!stop) setSrc(objectUrl);
    };
    img.onerror = async () => {
      try {
        const f = new FormData();
        f.append("file", file);
        f.append("preview", "1");
        const r = await fetch("/api/admin/media", { method: "POST", body: f });
        if (!r.ok) throw new Error((await r.json()).error);
        const blob = await r.blob();
        if (stop) return;
        URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (e) {
        if (!stop)
          setError(e instanceof Error ? e.message : "Неуспешен преглед.");
      }
    };
    img.src = objectUrl;
    return () => {
      stop = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  useEffect(() => {
    let active = true;
    if (!src || !canvas.current) return;
    const img = new Image();
    img.onload = () => {
      if (!active || !canvas.current) return;
      const c = canvas.current;
      const rotated = angle % 180 !== 0;
      const scale = Math.min(1, 420 / Math.max(img.width, img.height));
      const w = img.width * scale,
        h = img.height * scale;
      const raw = document.createElement("canvas");
      raw.width = Math.max(1, Math.round(rotated ? h : w));
      raw.height = Math.max(1, Math.round(rotated ? w : h));
      const ctx = raw.getContext("2d");
      if (!ctx) return;
      ctx.translate(raw.width / 2, raw.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      const left = Math.floor(raw.width * sides.left),
        top = Math.floor(raw.height * sides.top);
      c.width = raw.width - left - Math.floor(raw.width * sides.right);
      c.height = raw.height - top - Math.floor(raw.height * sides.bottom);
      c.getContext("2d")?.drawImage(
        raw,
        left,
        top,
        c.width,
        c.height,
        0,
        0,
        c.width,
        c.height,
      );
      setPreviewOk(true);
    };
    img.src = src;
    return () => {
      active = false;
    };
  }, [src, angle, sides]);
  function pick(f: File | undefined) {
    if (!f) return;
    setError("");
    setPreviewOk(false);
    setSrc("");
    if (f.size > 16 * 1024 * 1024) {
      setFile(null);
      setError("Избери снимка до 16 MB.");
      return;
    }
    setFile(f);
    setAngle(0);
    setSides(clearSides);
  }
  async function confirm() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const d = new FormData();
      d.set("file", file);
      d.set("rotation", String(angle));
      for (const [key, val] of Object.entries(sides)) d.set(key, String(val));
      const r = await fetch("/api/admin/media", { method: "POST", body: d });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setPhotos((prev) => (single ? [result] : [...prev, result]));
      setFile(null);
      setSrc("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Качването не успя.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(photos)} />
      <div className="adm-thumbs">
        {photos.map((photo, i) => (
          <div className="adm-thumb" key={photo.url}>
            <img
              src={photo.thumb || photo.url}
              alt={photo.alt || "Преглед на снимката"}
            />
            {!single &&
              (i === 0 ? (
                <strong>Основна снимка</strong>
              ) : (
                <button
                  className="adm-btn alt"
                  type="button"
                  onClick={() =>
                    setPhotos([photo, ...photos.filter((_, j) => j !== i)])
                  }
                >
                  Направи основна
                </button>
              ))}
            <button
              className="adm-link"
              type="button"
              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
            >
              Премахни
            </button>
          </div>
        ))}
      </div>
      <div className="adm-actions">
        <button
          type="button"
          className="adm-btn"
          onClick={() => camera.current?.click()}
        >
          Снимай {single ? "" : "продукта"}
        </button>
        <button
          type="button"
          className="adm-btn alt"
          onClick={() => gallery.current?.click()}
        >
          Избери от галерията
        </button>
        <button
          type="button"
          className="adm-btn alt"
          onClick={() => upload.current?.click()}
        >
          Качи файл
        </button>
      </div>
      <input
        ref={camera}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={gallery}
        hidden
        type="file"
        accept="image/*"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={upload}
        hidden
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file && (
        <div className="adm-photo-edit">
          <strong>Преглед преди запис</strong>
          <canvas
            ref={canvas}
            hidden={!src}
            className="adm-preview-img"
            aria-label="Предварителен преглед на изрязаната снимка"
          />
          <button
            type="button"
            className="adm-btn alt"
            onClick={() => {
              setAngle((angle + 90) % 360);
              setSides(clearSides);
            }}
          >
            Завърти на 90°
          </button>
          <details>
            <summary>Изрежи краищата</summary>
            <div className="adm-grid">
              {(Object.keys(sides) as (keyof typeof sides)[]).map((key) => (
                <label key={key} className="adm-field">
                  {sideTitles[key]} · {Math.round(sides[key] * 100)}%
                  <input
                    type="range"
                    min="0"
                    max="45"
                    value={Math.round(sides[key] * 100)}
                    onChange={(e) =>
                      setSides({
                        ...sides,
                        [key]: Number(e.target.value) / 100,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="adm-actions">
            <button
              disabled={busy || !previewOk}
              type="button"
              className="adm-btn"
              onClick={confirm}
            >
              {busy ? "Записване…" : "Потвърди снимката"}
            </button>
            <button
              disabled={busy}
              type="button"
              className="adm-btn alt"
              onClick={() => {
                setFile(null);
                setSrc("");
              }}
            >
              Отказ
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
