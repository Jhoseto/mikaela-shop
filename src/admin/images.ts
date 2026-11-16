import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { putFile, removeFile } from "@/storage";
import { InputIssue } from "./http";

const MAX_BYTES = 16 * 1024 * 1024;
const limits = { limitInputPixels: 52_000_000, failOn: "error" as const };
export async function normalizedImage(file: File) {
  if (!file.size || file.size > MAX_BYTES)
    throw new InputIssue("Избери изображение до 16 MB.");
  const raw = Buffer.from(await file.arrayBuffer());
  try {
    const meta = await sharp(raw, limits).metadata();
    if (
      !meta.format ||
      !["png", "jpeg", "webp", "heif"].includes(meta.format) ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 1
    )
      throw new InputIssue("Избери неподвижно JPEG, PNG или WebP изображение.");
    if (
      meta.width < 32 ||
      meta.height < 32 ||
      meta.width > 16000 ||
      meta.height > 16000
    )
      throw new InputIssue(
        "Снимката трябва да е между 32 и 16 000 пиксела по всяка страна.",
      );
    return await sharp(raw, limits)
      .autoOrient()
      .resize({
        width: 2560,
        height: 2560,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (err) {
    if (err instanceof InputIssue) throw err;
    throw new InputIssue(
      "Това изображение не може да се разчете. При HEIC избери JPEG от галерията или експортирай снимката като JPEG.",
    );
  }
}

export async function saveMedia(
  file: File,
  edit: {
    rotation: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  },
) {
  if (
    ![0, 90, 180, 270].includes(edit.rotation) ||
    [edit.left, edit.top, edit.right, edit.bottom].some(
      (n) => !Number.isFinite(n) || n < 0 || n >= 1,
    ) ||
    edit.left + edit.right > 0.9 ||
    edit.top + edit.bottom > 0.9
  )
    throw new InputIssue("Избери валидна област за изрязване.");
  const normalized = await normalizedImage(file);
  const rotated = await sharp(normalized)
    .rotate(edit.rotation)
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;
  const left = Math.floor(edit.left * width),
    top = Math.floor(edit.top * height);
  const box = {
    left,
    top,
    width: width - left - Math.floor(edit.right * width),
    height: height - top - Math.floor(edit.bottom * height),
  };
  const make = (size: number) =>
    sharp(rotated.data)
      .extract(box)
      .resize({
        width: size,
        height: size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  const [full, small] = await Promise.all([make(1400), make(480)]);
  const key = "uploads/" + randomUUID();
  const url = await putFile(key + ".webp", full, "image/webp");
  try {
    const thumb = await putFile(key + "-card.webp", small, "image/webp");
    return { url, thumb };
  } catch (err) {
    await removeFile(key + ".webp").catch(() => {});
    throw err;
  }
}
