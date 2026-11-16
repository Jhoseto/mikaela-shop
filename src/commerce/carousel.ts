export const carouselThemes = [
  "table",
  "citrus",
  "market",
  "coffee",
  "dessert",
] as const;
export type CarouselTheme = (typeof carouselThemes)[number];

export type CarouselSlide = {
  id: string;
  kind: "product" | "custom";
  enabled: boolean;
  productId: string;
  title: string;
  accent: string;
  detail: string;
  image: string;
  imageAlt: string;
  button: string;
  href: string;
  theme: CarouselTheme;
};

export type CarouselConfig = {
  mode: "auto" | "manual";
  autoPlay: boolean;
  intervalMs: number;
  slides: CarouselSlide[];
};

export type CarouselProductOption = {
  id: string;
  name: string;
  image: string;
  href: string;
  price: string;
};

export const defaultCarousel: CarouselConfig = {
  mode: "auto",
  autoPlay: true,
  intervalMs: 3800,
  slides: [],
};

export type CarouselRecord = {
  revision: number;
  version: number;
  draft: CarouselConfig | null;
  published: CarouselConfig | null;
};
