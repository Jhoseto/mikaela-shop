"use client";

import Link from "next/link";
import { defaultCarousel } from "@/commerce/carousel";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { m } from "motion/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from "react";
import "./brochure-hero.css";

export type HeroSlide = {
  id: string;
  title: string;
  accent?: string;
  product: string;
  detail: string;
  href: string;
  button: string;
  theme: "table" | "citrus" | "market" | "coffee" | "dessert";
  photo?: string;
  photoAlt?: string;
  packshot?: string;
  price?: string;
  priceLabel?: string;
  eyebrow?: string;
  conditions?: string;
};

type BrochureHeroProps = {
  slides: HeroSlide[];
  dates?: string;
  autoPlay?: boolean;
  intervalMs?: number;
};
type Direction = 1 | -1;
type ArtLayer = { id: string; key: number; direction: Direction; entering: boolean };
const turnMs = 1120;

function Headline({ slide }: { slide: HeroSlide }) {
  return <><span className="edition-lead">{slide.title}</span>{slide.accent && <> <br /><em>{slide.accent}</em></>}</>;
}

function description(slide: HeroSlide) {
  return slide.detail || (slide.product !== slide.title ? slide.product : "");
}

function Copy({ slide }: { slide: HeroSlide }) {
  return <>{description(slide)}{slide.conditions && <strong>{slide.conditions}</strong>}</>;
}

function Artwork({ slide, layer, leaving, priority }: { slide: HeroSlide; layer: ArtLayer; leaving: boolean; priority: boolean }) {
  const kind = slide.photo ? "" : slide.packshot ? " edition-still-life" : " edition-paper-art";
  return (
    <div className={"edition-artwork edition-" + slide.theme + kind + (leaving ? " edition-art-out" : " edition-art-current") + (layer.entering ? " edition-turn" : "")}
      data-entry={layer.direction === 1 ? "forward" : "back"} aria-hidden={leaving || undefined} inert={leaving || undefined}>
      {slide.photo ? (
        <img className={"edition-photo" + (leaving ? "" : " hero-image")} src={slide.photo} alt={leaving ? "" : slide.photoAlt || ""}
          fetchPriority={priority ? "high" : "auto"} />
      ) : slide.packshot ? (
        <div className="edition-pack-stage">
          <img className={"edition-pack-hero" + (leaving ? "" : " hero-image")} src={slide.packshot} alt={leaving ? "" : slide.product} />
        </div>
      ) : null}
      {layer.entering && <span className="edition-light" aria-hidden="true" />}
      {slide.price && (
        <div className={"edition-ticket" + (leaving ? " edition-ticket-out" : "")}>
          {slide.photo && slide.packshot && <img src={slide.packshot} alt="" className="edition-ticket-pack" />}
          <div className={leaving ? "edition-ticket-shadow-data" : "edition-ticket-data"}>
            {slide.priceLabel && <span>{slide.priceLabel}</span>}
            <b>{slide.price}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function BrochureHero({ slides, dates, autoPlay = true, intervalMs = defaultCarousel.intervalMs }: BrochureHeroProps) {
  const [frames, setFrames] = useState<ArtLayer[]>([]);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const region = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const latest = frames.at(-1);
  const current = Math.max(0, slides.findIndex((item) => item.id === latest?.id));
  const slide = slides[current];
  const layers = slide && latest?.id !== slide.id
    ? [{ id: slide.id, direction: 1 as Direction, key: 0, entering: false }] : frames;
  const previous = reduced ? undefined : slides.find((item) => item.id === layers.at(-2)?.id);
  const hasSlides = slides.length > 0;
  const running = autoPlay && slides.length > 1 && !paused && !hovered && !focused && !reduced && visible && inView;
  const delay = Number.isFinite(intervalMs) ? Math.min(20000, Math.max(3000, intervalMs)) : defaultCarousel.intervalMs;

  const move = useCallback((destination: number, direction: Direction) => {
    const next = slides[(destination + slides.length) % slides.length];
    if (next && slide && next.id !== slide.id) {
      setFrames((old) => {
        const base = old.at(-1)?.id === slide.id ? old : [{ id: slide.id, direction, key: 0, entering: false }];
        const key = base[base.length - 1].key + 1;
        const incoming = { id: next.id, direction, key, entering: !reduced };
        if (reduced) return [incoming];
        // Keep the visible composite under a new turn when a visitor navigates mid-reveal.
        return [...(base.length > 4 ? [base[0], ...base.slice(-3)] : base), incoming];
      });
    }
  }, [slides, slide, reduced]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(media.matches);
    const updateVisibility = () => setVisible(document.visibilityState === "visible");
    updateMotion();
    updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (region.current) observer.observe(region.current);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
    };
  }, [hasSlides]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => move(current + 1, 1), delay);
    return () => window.clearTimeout(timer);
  }, [running, current, delay, move]);

  useEffect(() => {
    if (!latest || !latest.entering) return;
    const timer = window.setTimeout(() => setFrames((state) =>
      state.at(-1) === latest ? [{ ...latest, entering: false }] : state), reduced ? 0 : turnMs + 30);
    return () => window.clearTimeout(timer);
  }, [latest, reduced]);

  useEffect(() => {
    if (!visible || !inView || slides.length < 2) return;
    const neighbours = [slides[(current + 1) % slides.length], slides[(current - 1 + slides.length) % slides.length]];
    const sources = new Set(neighbours.flatMap((item) => [item.photo, item.packshot]));
    const timer = window.setTimeout(() => {
      sources.forEach((src) => {
        if (!src) return;
        const image = new Image();
        image.decoding = "async";
        image.src = src;
        void image.decode().catch(() => {});
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [slides, current, inView, visible]);

  function show(next: number, direction: Direction) {
    setPaused(true);
    move(next, direction);
  }
  function finishSwipe(event: TouchEvent<HTMLElement>) {
    const start = touch.current;
    touch.current = null;
    if (!start || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const direction = dx < 0 ? 1 : -1;
      show(current + direction, direction);
    }
  }
  if (!slide) return null;
  const eyebrow = slide.eyebrow ?? dates;
  const buttons = [...new Set(slides.filter((s) => s.href && s.button).map((s) => s.button))];
  return (
    <section
      ref={region}
      aria-label="Акценти на началната страница"
      aria-roledescription={slides.length > 1 ? "карусел" : undefined}
      className={"edition-hero edition-" + slide.theme + (previous ? " is-changing" : "")}
      data-direction={latest?.direction === -1 ? "previous" : "next"}
      data-running={running || undefined}
      style={{ "--turn-time": turnMs + "ms", "--slide-time": delay + "ms" } as CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onKeyDown={(event) => {
        if (slides.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          show(current + direction, direction);
        }
      }}
      onTouchStart={(event) => {
        if (slides.length > 1 && event.touches.length === 1 && !(event.target as Element).closest("a,button")) {
          touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }
      }}
      onTouchEnd={finishSwipe}
      onTouchCancel={() => { touch.current = null; }}
    >
      <div className="edition-copy hero-copy">
        {slides.some((s) => s.eyebrow ?? dates) && <div className="edition-date">{eyebrow && <><span aria-hidden="true" />{eyebrow}</>}</div>}
        <div className="edition-headline-frame">
          {slides.length > 1 && slides.map((item) => <span key={item.id} aria-hidden="true" className="edition-title-size"><Headline slide={item} /></span>)}
          <h1 key={slide.id} className="edition-title"><Headline slide={slide} /></h1>
          {previous && <span key={"out-" + previous.id} className={"edition-leaving-title edition-" + previous.theme} aria-hidden="true"><Headline slide={previous} /></span>}
        </div>
        {slides.some((s) => description(s) || s.conditions) && <div className="edition-description-frame">
          {slides.length > 1 && slides.map((item) => <span key={item.id} className="edition-description-size" aria-hidden="true"><Copy slide={item} /></span>)}
          <p key={slide.id} className="edition-description"><Copy slide={slide} /></p>
        </div>}
        {buttons.length > 0 && <div className="edition-action-frame">
          {(buttons.length > 1 || !slide.href) && buttons.map((button) =>
            <span key={button} className="edition-cta-size" aria-hidden="true">{button}<ArrowRight size={17} /></span>)}
          {slide.href && slide.button && <Link className="edition-cta shop-button" href={slide.href}>
            {slide.button} <ArrowRight size={17} aria-hidden="true" />
          </Link>}
        </div>}
      </div>
      <div className="edition-stage">
        {(reduced ? layers.slice(-1) : layers).map((layer) => {
          const item = slides.find((s) => s.id === layer.id);
          return item && <Artwork key={layer.key} slide={item} layer={layer} leaving={layer !== layers.at(-1)} priority={layer.key === 0} />;
        })}
      </div>
      {slides.length > 1 && (
        <div className="edition-controls" aria-label="Избор на оферта">
          <button type="button" aria-label="Предишна оферта" onClick={() => show(current - 1, -1)}><ArrowLeft size={17} /></button>
          <div className="edition-dots">
            {slides.map((item, i) => (
              <button type="button" key={item.id} aria-label={"Покажи оферта " + (i + 1) + " · " + item.product}
                aria-current={i === current ? "true" : undefined} onClick={() => show(i, i < current ? -1 : 1)}><span /></button>
            ))}
          </div>
          <button type="button" aria-label="Следваща оферта" onClick={() => show(current + 1, 1)}><ArrowRight size={17} /></button>
          {autoPlay && !reduced && <button type="button" className="edition-play" aria-label={paused ? "Пусни автоматичната смяна" : "Спри автоматичната смяна"}
            onClick={() => {
              if (paused) {
                setHovered(false);
                setFocused(false);
              }
              setPaused(!paused);
            }}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
        </div>
      )}
      <span className="sr-only" aria-live={running ? "off" : "polite"} aria-atomic="true">
        {slide.product} {slide.price}
      </span>
    </section>
  );
}

/** Keep server-rendered shelves visible even before JavaScript is available. */
export function ShelfReveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <m.div className={"edition-reveal " + className} initial={false}
    whileInView={{ y: [9, 0] }} viewport={{ once: true, amount: 0.08 }} transition={{ duration: 0.42 }}>
    {children}
  </m.div>;
}
