import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0a0908",
          2: "#13110e",
          3: "#1a1714",
        },
        paper: {
          DEFAULT: "#ece6d4",
          2: "#c9c2ad",
          dim: "#807968",
        },
        rule: {
          DEFAULT: "#2d2a25",
          2: "#3d3a32",
        },
        amber: { DEFAULT: "#ff9f1c" },
        ember: { DEFAULT: "#ff6b1a" },
        cyan: { DEFAULT: "#5cf3ff" },
        green: { DEFAULT: "#84e4a1" },
      },
      fontFamily: {
        serif: ["Fraunces", "ui-serif", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["Inter Tight", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
