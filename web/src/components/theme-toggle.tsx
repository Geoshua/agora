"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    try {
      localStorage.setItem("andromeda-theme", next ? "dark" : "light");
    } catch {
      // ignore
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={toggle}
      className="border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 text-xs font-mono uppercase tracking-wider hover:border-amber hover:text-amber transition"
    >
      {dark === null ? (
        <span aria-hidden>theme</span>
      ) : dark ? (
        <span>light</span>
      ) : (
        <span>dark</span>
      )}
    </button>
  );
}
