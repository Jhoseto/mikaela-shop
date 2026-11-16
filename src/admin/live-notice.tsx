"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
type Stats = { latest: string; fresh: number; changed: string };
export function LiveNotice({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState(initial),
    [sound, setSound] = useState(false);
  const router = useRouter();
  const prev = useRef(initial);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    let alive = true;
    const accept = (s: Stats) => {
      if (!alive) return;
      const old = prev.current;
      prev.current = s;
      setStats(s);
      if (s.changed !== old.changed) router.refresh();
      if (Number(s.latest) > Number(old.latest) && sound && ctx.current) {
        const ac = ctx.current;
        const tone = ac.createOscillator(),
          vol = ac.createGain();
        tone.type = "sine";
        tone.frequency.value = 660;
        vol.gain.setValueAtTime(0.09, ac.currentTime);
        vol.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
        tone.connect(vol);
        vol.connect(ac.destination);
        tone.start();
        tone.stop(ac.currentTime + 0.2);
      }
    };
    const events = new EventSource("/api/admin/live");
    events.onmessage = (e) => {
      try {
        accept(JSON.parse(e.data));
      } catch {}
    };
    const timer = setInterval(async () => {
      try {
        const r = await fetch("/api/admin/live", { cache: "no-store" });
        if (r.ok) accept(await r.json());
      } catch {}
    }, 30000);
    return () => {
      alive = false;
      events.close();
      clearInterval(timer);
    };
  }, [sound, router]);
  return (
    <div className="adm-inline">
      <span aria-live="polite" className="adm-pill s-new">
        {stats.fresh} неприети
      </span>
      <button
        type="button"
        className="adm-btn alt"
        aria-pressed={sound}
        onClick={async () => {
          if (!sound) {
            ctx.current ??= new AudioContext();
            await ctx.current.resume();
          }
          setSound(!sound);
        }}
      >
        {sound ? "Изключи звука" : "Включи звук за нова поръчка"}
      </button>
    </div>
  );
}
