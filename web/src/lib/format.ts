// Pure presentation helpers — no I/O, no React.

export function truncatePubkey(pk: string, head = 8, tail = 6): string {
  if (!pk) return "";
  if (pk.length <= head + tail + 1) return pk;
  return `${pk.slice(0, head)}…${pk.slice(-tail)}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function honorStars(honor: number): { full: number; half: 0 | 1; empty: number } {
  // 5-star scale, 100 honor = 5 stars (capped).
  const ratio = Math.max(0, Math.min(1, honor / 100));
  const total10 = Math.round(ratio * 10);
  const full = Math.floor(total10 / 2);
  const half: 0 | 1 = total10 % 2 === 1 ? 1 : 0;
  const empty = 5 - full - half;
  return { full, half, empty };
}

export function formatSats(n: number): string {
  if (!isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function typeColor(t: string): string {
  switch (t) {
    case "verification":
      return "text-cyan-600 dark:text-cyan-400 border-cyan-500/40";
    case "audit":
      return "text-amber-600 dark:text-amber-400 border-amber-500/40";
    case "monitoring":
      return "text-emerald-600 dark:text-emerald-400 border-emerald-500/40";
    case "dataset":
      return "text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/40";
    default:
      return "text-zinc-600 dark:text-zinc-400 border-zinc-500/40";
  }
}
