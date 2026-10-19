// Regenerates lib/skill.js from data/SKILL-v6.7.md.
//
// lib/skill.js is that markdown inlined as one escaped JS string, so the prompt is a constant the
// bundler can see rather than a file read on every request. The two files can drift, and until this
// script existed nothing noticed: the header comment said "regenerate" without saying with what.
//
//   node scripts/build-skill.mjs           rewrite lib/skill.js
//   node scripts/build-skill.mjs --check   regenerate in memory, exit 1 if the committed file differs
//
// Node builtins only, deliberately: package-lock.json is committed and cannot be regenerated in
// every environment this runs in, so a new dependency here would break npm ci.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "data/SKILL-v6.7.md";
const TARGET = "lib/skill.js";

// Everything that cannot sit literally inside a double-quoted JS string, plus the two line
// separators that are legal in a string but end a line for some parsers, plus the remaining
// control characters. The backslash rule runs first or it escapes the escapes.
const escape = (s) => s
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\n/g, "\\n")
  .replace(/\r/g, "\\r")
  .replace(/\t/g, "\\t")
  .replace(/[\u2028\u2029]/g, (c) => "\\u" + c.codePointAt(0).toString(16))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => "\\u" + c.codePointAt(0).toString(16).padStart(4, "0"));

const md = readFileSync(join(root, SOURCE), "utf8");
const version = (md.match(/^version:\s*([0-9.]+)/m) || [])[1] || "unknown";
const literal = `"${escape(md)}"`;

// Self-check before anything is written: the literal must read back as exactly the markdown. Every
// escape above is also valid JSON, so JSON.parse is a fair reader of it, and a round trip failing
// here means the escaping is wrong and the prompt would ship corrupted.
if (JSON.parse(literal) !== md) {
  console.error(`Escaping is wrong: the generated literal does not round-trip to ${SOURCE}.`);
  process.exit(1);
}

const generated = `// Generated from ${SOURCE} (v${version}) by scripts/build-skill.mjs. Edit the .md, then regenerate: npm run build:skill
export const SKILL = ${literal};
`;

if (process.argv.includes("--check")) {
  const committed = readFileSync(join(root, TARGET), "utf8");
  if (committed === generated) {
    console.log(`${TARGET} is up to date with ${SOURCE} (v${version}).`);
    process.exit(0);
  }
  console.error(`${TARGET} does not match ${SOURCE} (v${version}). Run: npm run build:skill`);
  process.exit(1);
}

writeFileSync(join(root, TARGET), generated);
console.log(`Wrote ${TARGET} from ${SOURCE} (v${version}): ${md.length} characters of markdown.`);
