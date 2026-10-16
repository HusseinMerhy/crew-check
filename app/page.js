export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: "0 16px" }}>
      <h1 style={{ color: "#1F3A5F", marginBottom: 4 }}>OSHA check bot</h1>
      <p style={{ color: "#6B7280", marginTop: 0 }}>Proof of concept: does this quote need a second tech under OSHA?</p>
      <div style={{ background: "#fff", border: "1px solid #E3E8EF", borderRadius: 8, padding: 16 }}>
        <p style={{ margin: 0 }}>Version 3: passcode on. To test the Claude API key, open /api/health on this site. The checker comes next.</p>
      </div>
    </main>
  );
}
