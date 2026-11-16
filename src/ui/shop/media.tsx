import { ImageOff } from "lucide-react";
export function ProductImage({
  src,
  name,
  className = "",
  eager = false,
  small = false,
}: {
  src?: string;
  name: string;
  className?: string;
  eager?: boolean;
  small?: boolean;
}) {
  if (!src)
    return (
      <span className={"no-image " + className} aria-label="Снимката предстои">
        <ImageOff size={24} strokeWidth={1.3} />
      </span>
    );
  const hasUploadThumbnail = /^\/media\/uploads\/[a-f0-9-]{36}\.webp$/i.test(src);
  const hasBrochureThumbnail =
    /^\/media\/brochures\/[a-f0-9]{64}\/v(?:[3-9]|\d{2,})\/p\d+-i\d+-photo\.webp$/i.test(src);
  const file = small && (hasUploadThumbnail || hasBrochureThumbnail)
    ? src.replace(/\.webp$/i, "-card.webp")
    : src;
  return (
    <img
      className={className}
      src={file}
      alt={name}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
