import { honorStars } from "@/lib/format";

const StarSvg = ({ fill }: { fill: "full" | "half" | "empty" }) => {
  const id = `g-${Math.random().toString(36).slice(2, 8)}`;
  if (fill === "full") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="inline-block">
        <path
          d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.5 5.8 21.1l1.6-7L2 9.3l7.1-.7L12 2z"
          fill="#ff9f1c"
        />
      </svg>
    );
  }
  if (fill === "empty") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="inline-block">
        <path
          d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.5 5.8 21.1l1.6-7L2 9.3l7.1-.7L12 2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.4"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="inline-block">
      <defs>
        <linearGradient id={id}>
          <stop offset="50%" stopColor="#ff9f1c" />
          <stop offset="50%" stopColor="transparent" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.5 5.8 21.1l1.6-7L2 9.3l7.1-.7L12 2z"
        fill={`url(#${id})`}
        stroke="#ff9f1c"
        strokeWidth="1.2"
      />
    </svg>
  );
};

export function HonorStars({ honor }: { honor: number }) {
  const { full, half, empty } = honorStars(honor);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Honor ${honor}`}>
      {Array.from({ length: full }).map((_, i) => (
        <StarSvg key={`f-${i}`} fill="full" />
      ))}
      {half === 1 && <StarSvg fill="half" />}
      {Array.from({ length: empty }).map((_, i) => (
        <StarSvg key={`e-${i}`} fill="empty" />
      ))}
      <span className="ml-1 font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
        {honor}
      </span>
    </span>
  );
}
