// Minimal home page — redirects directly to /api/v1/health for now.
// Full HTML index can come in Phase 7's web/.

export default function Home() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", padding: 32 }}>
      <h1>Andromeda Registry</h1>
      <p>Multi-seller catalog for the Andromeda Lightning marketplace.</p>
      <ul>
        <li><a href="/api/v1/health">/api/v1/health</a></li>
        <li><a href="/api/v1/sellers">/api/v1/sellers</a></li>
        <li><a href="/api/v1/services">/api/v1/services</a></li>
      </ul>
    </main>
  );
}
