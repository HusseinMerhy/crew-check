"use client";
// The Backlog Chaser shell: left rail with the menu, a top bar with where you are, and the page.
// A client component only because the menu marks the open page and folds away on a phone.
import { useState } from "react";
import { usePathname } from "next/navigation";

const ICONS = {
  check: <svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>,
  queue: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  eval: <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  clients: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5.1" /></svg>,
  menu: <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
};

const NAV = [
  { grp: "Quotes" },
  { href: "/", label: "Check a quote", icon: "check" },
  { href: "/queue", label: "Daily queue", icon: "queue" },
  { href: "/clients", label: "Clients", icon: "clients" },
  { grp: "Quality" },
  { href: "/eval", label: "Test results", icon: "eval" },
];

export default function Shell({ children }) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const here = NAV.find((n) => n.href && (n.href === "/" ? path === "/" : path.startsWith(n.href)));

  return (
    <div className="app">
      <aside className={`rail${open ? " open" : ""}`}>
        <a className="brand" href="/">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 38 38"><rect width="38" height="38" rx="10" fill="var(--signal)" /><path d="M10 12 L19 27 L28 12" fill="none" stroke="var(--signal-ink)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="28" cy="12" r="3" fill="var(--tape)" /></svg>
          </span>
          <span><b>Quote Builder</b><span>Vista · Quoting</span></span>
        </a>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.map((n, i) => n.grp
            ? <div className="grp" key={i}>{n.grp}</div>
            : <a key={n.href} href={n.href} className={here === n ? "on" : ""}>{ICONS[n.icon]}{n.label}</a>)}
        </nav>
        <div className="rail-foot">
          <b>Read only on ClickUp</b>
        </div>
      </aside>
      <div className={`scrim${open ? " show" : ""}`} onClick={() => setOpen(false)} />
      <div className="main">
        <div className="topbar">
          <button className="btn ghost sm menu-btn" aria-label="Menu" onClick={() => setOpen(true)}>{ICONS.menu}</button>
          <div className="crumb">Quote Builder / <b>{here?.label || "Page"}</b></div>
          <div className="sp" />
          <a className="engine" href="/queue"><span className="dot" /><span>Daily check · 11:00 UTC</span></a>
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
