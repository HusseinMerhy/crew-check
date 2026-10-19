import "./globals.css";

export const metadata = {
  title: "Crew check",
  description: "Vendor Sourcing Dispatcher: does this quote need a second tech under OSHA?",
};

// Without the viewport meta the page lays out at a notional 980px and the browser scales the
// whole thing down, so the 620px breakpoint in globals.css never fires: the three verdict tiles
// stay crushed into one row and the values are unreadable. This was observed on a phone-width
// viewport, not theorised.
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* The topbar is static chrome: no state, no handlers, the same on every render. It lives
            here rather than in page.js because page.js is a client component, and there is no
            reason to ship markup that never changes to the browser as part of one. */}
        <div className="topbar">
          <div className="brand">
            <div className="logo">V</div>
            <div>
              <strong>Vendor Sourcing</strong>
              <small>Dispatcher</small>
            </div>
          </div>
          <div>
            <div className="top-title">OSHA crew check</div>
            <div className="top-sub">Second-tech justification</div>
          </div>
          <div className="pill">Proof of concept</div>
        </div>
        {children}
      </body>
    </html>
  );
}
