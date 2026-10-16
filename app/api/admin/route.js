// Admin route: create the tables and load cards / past quotes.
// Protected by a token whose SHA-256 fingerprint is below. The token itself is not in the code or in GitHub.
// To lock this route for good, replace ADMIN_HASH with "" (then every request is refused).
import { createHash } from "node:crypto";
import { getSql, toVec, isVector } from "../../../lib/db";
export const dynamic = "force-dynamic";

const ADMIN_HASH = "aa2bc9237621126ec98c5822f9305a4e951af9dbd794f4a3c47750e70f662486";

const SETUP = [
  `create extension if not exists vector`,
  `create table if not exists cards (
     id text primary key, state text not null, layer text not null, citation text not null,
     title text not null, body text not null, source text not null, checked date not null,
     embedding vector(384))`,
  `create table if not exists past_quotes (
     id bigint primary key generated always as identity, category text, job text, tech_reported text, steps text,
     tech1_h numeric, tech2_h numeric, same_hours boolean, reason_found text, embedding vector(384))`,
  `create index if not exists past_quotes_emb_idx on past_quotes using hnsw (embedding vector_cosine_ops)`,
  `create table if not exists checks (
     id bigint primary key generated always as identity, created_at timestamptz not null default now(),
     state text, quote_text text, model text, cards jsonb, similar_quotes jsonb, answer text,
     tokens_in int, tokens_out int)`,
];

export async function POST(req) {
  const token = req.headers.get("x-admin-token") || "";
  if (!ADMIN_HASH || createHash("sha256").update(token).digest("hex") !== ADMIN_HASH) {
    return Response.json({ ok: false, problem: "not allowed" }, { status: 403 });
  }
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, problem: "DATABASE_URL is not set" }, { status: 500 });
  const body = await req.json();

  try {
    if (body.action === "setup") {
      for (const s of SETUP) await sql.query(s);
      return Response.json({ ok: true });
    }
    if (body.action === "cards") {
      for (const c of body.rows) {
        if (!isVector(c.embedding)) return Response.json({ ok: false, problem: `bad vector for ${c.id}` }, { status: 400 });
        await sql.query(
          `insert into cards (id,state,layer,citation,title,body,source,checked,embedding) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)
           on conflict (id) do update set state=excluded.state, layer=excluded.layer, citation=excluded.citation, title=excluded.title,
           body=excluded.body, source=excluded.source, checked=excluded.checked, embedding=excluded.embedding`,
          [c.id, c.state, c.layer, c.citation, c.title, c.body, c.source, c.checked, toVec(c.embedding)]);
      }
      return Response.json({ ok: true, n: body.rows.length });
    }
    if (body.action === "quotes") {
      const rows = body.rows;
      const vals = [], params = [];
      rows.forEach((r, i) => {
        if (!isVector(r.embedding)) throw new Error("bad vector in quotes batch");
        const b = i * 9;
        vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}::vector)`);
        params.push(r.category, r.job, r.tech_reported, r.steps, r.tech1_h, r.tech2_h, r.same_hours, r.reason_found, toVec(r.embedding));
      });
      await sql.query(`insert into past_quotes (category,job,tech_reported,steps,tech1_h,tech2_h,same_hours,reason_found,embedding) values ${vals.join(",")}`, params);
      return Response.json({ ok: true, n: rows.length });
    }
    if (body.action === "stats") {
      const [c] = await sql.query(`select count(*)::int n from cards`);
      const [q] = await sql.query(`select count(*)::int n from past_quotes`);
      const [k] = await sql.query(`select count(*)::int n from checks`);
      return Response.json({ ok: true, cards: c.n, past_quotes: q.n, checks: k.n });
    }
    return Response.json({ ok: false, problem: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, problem: String(e.message || e).slice(0, 300) }, { status: 500 });
  }
}
