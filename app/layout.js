import "./globals.css";
import Shell from "./shell";

export const metadata = {
  title: "Crew Check",
  description: "Vista quoting: does this quote need a second tech, and what does this entity usually get accepted?",
};

// Without the viewport meta the page lays out at a notional 980px and the browser scales the
// whole thing down, so the phone breakpoints in globals.css never fire. Observed, not theorised.
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* The Backlog Chaser fonts: Instrument Sans for text, Bricolage Grotesque for headings. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
