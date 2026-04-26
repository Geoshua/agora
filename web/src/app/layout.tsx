import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Andromeda — Agents pay agents over Lightning",
  description:
    "Public read-only index of the Andromeda marketplace. Browse sellers, services, and live stats from the registry.",
};

// Inline theme bootstrap. Runs before paint to avoid flash-of-wrong-theme.
// Reads localStorage; falls back to system preference.
const themeBootstrap = `(function(){try{var s=localStorage.getItem('andromeda-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..900&family=JetBrains+Mono:wght@400..600&family=Inter+Tight:wght@300..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 backdrop-blur sticky top-0 z-30 bg-[#fafaf7]/80 dark:bg-[#0a0908]/80">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-6">
        <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
          Andromeda
        </Link>
        <nav className="hidden sm:flex items-center gap-5 text-sm text-zinc-600 dark:text-zinc-300 font-mono uppercase tracking-wider">
          <Link href="/sellers" className="hover:text-amber">Sellers</Link>
          <Link href="/services" className="hover:text-amber">Services</Link>
          <Link href="/search" className="hover:text-amber">Search</Link>
          <Link href="/recommend" className="hover:text-amber">Recommend</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-16">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs text-zinc-500 dark:text-zinc-400 font-mono uppercase tracking-wider">
        <div>ANDROMEDA · Lightning-paid agent marketplace · read-only public index</div>
        <div className="flex gap-4">
          <Link href="/sellers" className="hover:text-amber">/sellers</Link>
          <Link href="/services" className="hover:text-amber">/services</Link>
          <Link href="/search" className="hover:text-amber">/search</Link>
          <Link href="/recommend" className="hover:text-amber">/recommend</Link>
        </div>
      </div>
    </footer>
  );
}
