// Build a single PDF deck from the 6 SVGs + the 60-second script.
// Renders to PDF via headless Edge (no npm install needed).
//
// Run: node tools/build-demo-pdf.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const diagramsDir = join(repoRoot, "docs", "diagrams");
const tmpDir = join(repoRoot, "tools", "_tmp");
const htmlPath = join(tmpDir, "agora-deck.html");
const pdfPath = join(diagramsDir, "agora-tech-demo.pdf");

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

const svgs = [
  ["01-architecture.svg",      "Architecture"],
  ["02-l402-flow.svg",         "L402 round-trip"],
  ["03-identity-signing.svg",  "Identity"],
  ["06-mcp-bridge.svg",        "MCP bridge"],
  ["05-money-flow.svg",        "Money flow"],
  ["04-phases.svg",            "Phases"],
];

const slides = svgs.map(([file]) =>
  readFileSync(join(diagramsDir, file), "utf8").replace(/<\?xml[^>]+\?>/, "")
);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agora — tech demo</title>
<style>
  @page { size: 1280px 720px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111827;
    background: #ffffff;
  }
  .slide {
    width: 1280px;
    height: 720px;
    page-break-after: always;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }
  .slide:last-child { page-break-after: auto; }
  .slide svg {
    width: 100%;
    height: 100%;
    max-width: 1280px;
    max-height: 720px;
  }
  .footer {
    position: absolute;
    bottom: 16px;
    right: 24px;
    font-size: 11px;
    color: #9ca3af;
  }

  /* Cover */
  .cover {
    flex-direction: column;
    background: linear-gradient(135deg, #fef3c7 0%, #ffffff 60%, #ecfdf5 100%);
    text-align: center;
    padding: 0 80px;
  }
  .cover .badge {
    display: inline-block;
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #ca8a04;
    border-radius: 999px;
    padding: 6px 18px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 32px;
  }
  .cover h1 {
    font-size: 88px;
    font-weight: 800;
    margin: 0;
    letter-spacing: -0.02em;
    color: #111827;
  }
  .cover h2 {
    font-size: 28px;
    font-weight: 500;
    color: #4b5563;
    margin: 18px 0 0;
  }
  .cover .meta {
    margin-top: 56px;
    font-size: 14px;
    color: #6b7280;
    font-family: ui-monospace, "Cascadia Code", monospace;
  }
  .cover .stats {
    display: flex;
    gap: 64px;
    margin-top: 40px;
  }
  .cover .stat { text-align: center; }
  .cover .stat .num {
    font-size: 40px;
    font-weight: 800;
    color: #111827;
  }
  .cover .stat .label {
    font-size: 12px;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: 4px;
  }

  /* Script slide */
  .script {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    padding: 60px 80px;
  }
  .script h1 {
    font-size: 32px;
    margin: 0 0 8px;
    color: #111827;
  }
  .script .sub {
    font-size: 14px;
    color: #6b7280;
    margin-bottom: 28px;
  }
  .beat {
    margin-bottom: 18px;
    padding: 14px 18px;
    background: #f9fafb;
    border-left: 4px solid #4f46e5;
    border-radius: 0 8px 8px 0;
  }
  .beat .head {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #4f46e5;
    margin-bottom: 6px;
  }
  .beat .head .slide-tag {
    color: #6b7280;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 8px;
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 11px;
  }
  .beat .head .timing {
    float: right;
    color: #6b7280;
    font-weight: 500;
  }
  .beat p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: #1f2937;
  }
  .beat strong { color: #111827; }

  /* Appendix slide */
  .appendix {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    padding: 60px 80px;
  }
  .appendix h1 {
    font-size: 32px;
    margin: 0 0 28px;
  }
  .appendix .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 36px;
  }
  .appendix h3 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #4f46e5;
    margin: 0 0 14px;
  }
  .appendix table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .appendix td {
    padding: 6px 8px;
    border-bottom: 1px solid #e5e7eb;
  }
  .appendix td:last-child {
    text-align: right;
    font-weight: 600;
    font-family: ui-monospace, "Cascadia Code", monospace;
  }
  .appendix code {
    display: block;
    background: #1f2937;
    color: #f3f4f6;
    padding: 14px 18px;
    border-radius: 8px;
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 12px;
    line-height: 1.6;
    margin-top: 10px;
  }
</style>
</head>
<body>

<!-- COVER -->
<section class="slide cover">
  <span class="badge">⚡ SPIRAL × Hack-Nation Challenge 02</span>
  <h1>Agora</h1>
  <h2>A Lightning-paid agent marketplace</h2>
  <div class="stats">
    <div class="stat"><div class="num">8</div><div class="label">build phases</div></div>
    <div class="stat"><div class="num">144 / 144</div><div class="label">tests green</div></div>
    <div class="stat"><div class="num">~200 ms</div><div class="label">per paid call</div></div>
    <div class="stat"><div class="num">0</div><div class="label">accounts</div></div>
  </div>
  <div class="meta">github.com/Geoshua/agora · ${new Date().toISOString().slice(0, 10)}</div>
</section>

<!-- 6 SVG SLIDES -->
${slides.map((svg, i) => `
<section class="slide">
  ${svg}
  <div class="footer">${i + 1} / ${slides.length}  ·  Agora — tech demo</div>
</section>`).join("")}

<!-- SCRIPT SLIDE -->
<section class="slide script">
  <h1>60-second demo script</h1>
  <div class="sub">≈ 145 words · 5 beats · read off this page or the rendered slides</div>

  <div class="beat">
    <div class="head">Beat 1 — hook <span class="slide-tag">[01-architecture]</span><span class="timing">10 s</span></div>
    <p><strong>Agora is a marketplace where AI agents pay each other over the Lightning Network — no accounts, no API keys, no checkout.</strong> Five services: a registry, three sellers, a Claude bridge.</p>
  </div>

  <div class="beat">
    <div class="head">Beat 2 — the atom <span class="slide-tag">[02-l402-flow]</span><span class="timing">15 s</span></div>
    <p><strong>One paid call takes 200 milliseconds.</strong> The agent posts a request — gets back HTTP 402 and a Lightning invoice. Pays it. Replays the request with the preimage as proof. Server verifies, returns the result. That's the whole protocol — it's called L402.</p>
  </div>

  <div class="beat">
    <div class="head">Beat 3 — no accounts <span class="slide-tag">[03-identity-signing]</span><span class="timing">10 s</span></div>
    <p><strong>Identity is an Ed25519 keypair.</strong> Every agent generates one on first run. The public key IS the agent's global ID. Every cross-service call is signed. There is no users table.</p>
  </div>

  <div class="beat">
    <div class="head">Beat 4 — the agent UX <span class="slide-tag">[06-mcp-bridge]</span><span class="timing">10 s</span></div>
    <p><strong>You give Claude a goal and a sat budget.</strong> A per-call cap, a per-session budget, and a kill switch sit between Claude and your wallet. You stay in custody.</p>
  </div>

  <div class="beat">
    <div class="head">Beat 5 — close <span class="slide-tag">[04-phases]</span><span class="timing">15 s</span></div>
    <p><strong>Eight build phases, 144 of 144 tests green, three independent security audits.</strong> L402 wire format is byte-aligned with MoneyDevKit. Mock mode runs offline; flip two flags and you're on Lightning mainnet. <strong>The repo is live. The marketplace works today.</strong></p>
  </div>
  <div class="footer">7 / 8  ·  Agora — tech demo</div>
</section>

<!-- APPENDIX -->
<section class="slide appendix">
  <h1>Numbers + commands</h1>
  <div class="grid">
    <div>
      <h3>Numbers worth quoting</h3>
      <table>
        <tr><td>Per-call latency (mainnet)</td><td>~200 ms</td></tr>
        <tr><td>Cheapest paid call (order receipt)</td><td>120 sat</td></tr>
        <tr><td>Most expensive paid call (NOAA dataset)</td><td>5000 sat</td></tr>
        <tr><td>Smallest unit cards can price</td><td>~30¢</td></tr>
        <tr><td>Build phases shipped</td><td>8</td></tr>
        <tr><td>Test gates green</td><td>144 / 144</td></tr>
        <tr><td>MCP tools registered</td><td>30</td></tr>
        <tr><td>Lightning fee on a 240-sat call</td><td>~1 sat</td></tr>
      </table>
    </div>
    <div>
      <h3>Try it after the demo</h3>
      <code>git clone git@github.com:Geoshua/agora.git
cd agora
npm run install:all
npm run demo:multi</code>
      <p style="font-size:12px;color:#6b7280;margin-top:14px;">
        Mock mode default — no wallet needed. ~200 ms × 2 paid calls.<br>
        For mainnet: paste two NWC strings + flip MOCK_MODE=false.
      </p>

      <h3 style="margin-top:28px;">Repo</h3>
      <p style="font-family:ui-monospace,monospace;font-size:13px;margin:0;">github.com/Geoshua/agora</p>
      <p style="font-size:12px;color:#6b7280;margin-top:6px;">8 ADRs · 6 diagrams · 3 audit reports · live activity feed at /activity</p>
    </div>
  </div>
  <div class="footer">8 / 8  ·  Agora — tech demo</div>
</section>

</body>
</html>
`;

writeFileSync(htmlPath, html, "utf8");
console.log(`HTML written: ${htmlPath} (${html.length} bytes)`);

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const fileUrl = `file:///${htmlPath.replace(/\\/g, "/")}`;

console.log(`Rendering PDF via headless Edge...`);
execFileSync(edge, [
  "--headless=new",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${pdfPath}`,
  fileUrl,
], { stdio: "inherit" });

console.log(`PDF written: ${pdfPath}`);
