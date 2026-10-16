// Database connection (Neon Postgres, added to the project from Vercel → Storage).
// Vercel puts the connection string in DATABASE_URL automatically. It never appears in code.
import { neon } from "@neondatabase/serverless";

export function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return url ? neon(url) : null;
}

// pgvector expects '[0.1,0.2,...]'
export const toVec = (arr) => "[" + arr.map((x) => Number(x).toFixed(6)).join(",") + "]";

export const isVector = (v) => Array.isArray(v) && v.length === 384 && v.every((x) => typeof x === "number" && Number.isFinite(x));

// Remove dollar amounts before anything is stored.
export const stripMoney = (t) => String(t || "").replace(/\$\s?[\d,]+(\.\d+)?/g, "$[removed]");
