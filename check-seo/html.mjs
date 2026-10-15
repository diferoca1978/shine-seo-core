// The page model every adapter produces and every rule reads, and the minimal tag
// reader underneath it (enough for the predictable HTML Astro emits).
// Ported from astro-harness@1915d59 (harness/check-seo.mjs) unchanged, plus readLocs.

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  uuml: "ü",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  Uuml: "Ü",
  iexcl: "¡",
  iquest: "¿",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  deg: "°",
};

/** Decodes numeric references and the named entities above; others stay as-is. */
function decodeEntities(s) {
  if (!s.includes("&")) return s;
  return s.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g,
    (match, ref) => {
      if (ref[0] === "#") {
        const hex = ref[1] === "x" || ref[1] === "X";
        const cp = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
      }
      return Object.hasOwn(NAMED_ENTITIES, ref) ? NAMED_ENTITIES[ref] : match;
    },
  );
}

// ---------------------------------------------------------------------------
// Tag reader — a minimal tokenizer, enough for the predictable HTML Astro emits
// ---------------------------------------------------------------------------
//
// readTags(html) returns tokens in document order:
//   { type: 'open',  name, attrs, selfClosing, start, end, inForeign, inTemplate, content? }
//   { type: 'close', name, start, end, inForeign, inTemplate }
//   { type: 'text',  text, start, end, inForeign, inTemplate }   (raw, not decoded)
//
// - Tag and attribute names are lowercased. Attribute values accept any quote
//   style or none, in any order, and are entity-decoded. The first duplicate
//   attribute wins, as in HTML.
// - <script> and <style> are raw text: their body is `content`, untouched.
//   <title> and <textarea> are RCDATA: `content` is entity-decoded. For all
//   four, the body produces no tokens.
// - inForeign: inside <svg> or <math> (an SVG <title> is not the page title).
//   inTemplate: inside <template>, whose content is inert.
// - Comments, doctypes and processing instructions produce no tokens.

const RAW_TEXT = new Set(["script", "style"]);
const RCDATA = new Set(["title", "textarea"]);
const FOREIGN = new Set(["svg", "math"]);
const TAG_NAME = /[A-Za-z][^\s/>]*/y;
const CLOSE_TAG = /<\/([A-Za-z][^\s/>]*)[^>]*>?/y;
const ATTR_NAME = /[^\s"'>/=]+/y;
const UNQUOTED_VALUE = /[^\s>]*/y;
const WHITESPACE = /\s/;
const LETTER = /[A-Za-z]/;

function readTags(html) {
  const tokens = [];
  const n = html.length;
  let foreign = 0;
  let template = 0;
  let pos = 0;
  let textStart = 0;
  const context = () => ({ inForeign: foreign > 0, inTemplate: template > 0 });
  const flushText = (end) => {
    if (end > textStart) {
      tokens.push({
        type: "text",
        text: html.slice(textStart, end),
        start: textStart,
        end,
        ...context(),
      });
    }
  };

  while (pos < n) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    const next = html[lt + 1] ?? "";

    if (html.startsWith("<!--", lt)) {
      flushText(lt);
      const close = html.indexOf("-->", lt + 4);
      pos = textStart = close === -1 ? n : close + 3;
    } else if (next === "!" || next === "?") {
      flushText(lt);
      const close = html.indexOf(">", lt + 2);
      pos = textStart = close === -1 ? n : close + 1;
    } else if (next === "/" && LETTER.test(html[lt + 2] ?? "")) {
      flushText(lt);
      CLOSE_TAG.lastIndex = lt;
      const m = CLOSE_TAG.exec(html);
      const name = m[1].toLowerCase();
      if (FOREIGN.has(name) && foreign > 0) foreign--;
      if (name === "template" && template > 0) template--;
      const end = lt + m[0].length;
      tokens.push({ type: "close", name, start: lt, end, ...context() });
      pos = textStart = end;
    } else if (LETTER.test(next)) {
      flushText(lt);
      const tag = readOpenTag(html, lt);
      const token = { type: "open", ...tag, start: lt, ...context() };
      tokens.push(token);
      pos = textStart = tag.end;
      if (RAW_TEXT.has(tag.name) || RCDATA.has(tag.name)) {
        const closeRe = new RegExp(`</${tag.name}(?=[\\s/>]|$)`, "ig");
        closeRe.lastIndex = tag.end;
        const m = closeRe.exec(html);
        const bodyEnd = m ? m.index : n;
        const body = html.slice(tag.end, bodyEnd);
        token.content = RCDATA.has(tag.name) ? decodeEntities(body) : body;
        pos = textStart = bodyEnd; // the loop reads the close tag next
      } else if (!tag.selfClosing) {
        if (FOREIGN.has(tag.name)) foreign++;
        if (tag.name === "template") template++;
      }
    } else {
      pos = lt + 1; // a stray "<" is text
    }
  }
  flushText(n);
  return tokens;
}

function readOpenTag(html, lt) {
  const n = html.length;
  TAG_NAME.lastIndex = lt + 1;
  const name = TAG_NAME.exec(html)[0].toLowerCase();
  let pos = TAG_NAME.lastIndex;
  const attrs = Object.create(null);
  let slash = false;

  while (pos < n) {
    const ch = html[pos];
    if (ch === ">") return { name, attrs, selfClosing: slash, end: pos + 1 };
    if (ch === "/") {
      slash = true;
      pos++;
      continue;
    }
    slash = false;
    if (WHITESPACE.test(ch)) {
      pos++;
      continue;
    }
    ATTR_NAME.lastIndex = pos;
    const m = ATTR_NAME.exec(html);
    if (!m) {
      pos++; // a stray quote or "="
      continue;
    }
    const attrName = m[0].toLowerCase();
    pos = ATTR_NAME.lastIndex;
    while (pos < n && WHITESPACE.test(html[pos])) pos++;
    let value = "";
    if (html[pos] === "=") {
      pos++;
      while (pos < n && WHITESPACE.test(html[pos])) pos++;
      const quote = html[pos];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, pos + 1);
        value = html.slice(pos + 1, close === -1 ? n : close);
        pos = close === -1 ? n : close + 1;
      } else {
        UNQUOTED_VALUE.lastIndex = pos;
        value = UNQUOTED_VALUE.exec(html)[0];
        pos = UNQUOTED_VALUE.lastIndex;
      }
    }
    if (!Object.hasOwn(attrs, attrName))
      attrs[attrName] = decodeEntities(value);
  }
  return { name, attrs, selfClosing: false, end: n };
}

// ---------------------------------------------------------------------------
// Page model — what every adapter produces and every rule reads
// ---------------------------------------------------------------------------
//
// page = { url, status, html, kind, label }
//   url    the page's own URL (absolute)
//   status HTTP status (in --dist: 404 for 404.html, 200 for the rest)
//   kind   '404'       dist/404.html, in --dist only
//          'noindex'   its <meta name="robots"> content includes "noindex"
//          'indexable' every other page
//   label  how the output names the page (the file path in --dist)

const tagCache = new WeakMap();

function tagsOf(page) {
  let tokens = tagCache.get(page);
  if (!tokens) {
    tokens = readTags(page.html);
    tagCache.set(page, tokens);
  }
  return tokens;
}

/** Open tags named `name` in the page's own document (not SVG, not <template>). */
function elements(page, name) {
  return tagsOf(page).filter(
    (t) =>
      t.type === "open" && t.name === name && !t.inForeign && !t.inTemplate,
  );
}

function metaByName(page, name) {
  return elements(page, "meta").filter(
    (t) => (t.attrs.name ?? "").trim().toLowerCase() === name,
  );
}

function relTokens(tag) {
  return (tag.attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function linksByRel(page, rel) {
  return elements(page, "link").filter((t) => relTokens(t).includes(rel));
}

function makePage({ url, status, html, label, is404 = false }) {
  const page = { url, status, html, kind: "indexable", label };
  if (is404) {
    page.kind = "404";
  } else if (
    metaByName(page, "robots").some((m) =>
      (m.attrs.content ?? "").toLowerCase().includes("noindex"),
    )
  ) {
    page.kind = "noindex";
  }
  return page;
}

// ---------------------------------------------------------------------------
// JSON-LD and visible text — derived from the page model, cached per page
// ---------------------------------------------------------------------------

const jsonldCache = new WeakMap();
const nodeCache = new WeakMap();
const textCache = new WeakMap();

/**
 * The page's <script type="application/ld+json"> blocks, in document order
 * (not inside <template> or SVG): [{ n, data, error }], n counted from 1.
 * `error` holds the JSON.parse message when the block is not JSON.
 */
function jsonldBlocks(page) {
  let blocks = jsonldCache.get(page);
  if (!blocks) {
    blocks = elements(page, "script")
      .filter(
        (t) =>
          (t.attrs.type ?? "").split(";")[0].trim().toLowerCase() ===
          "application/ld+json",
      )
      .map((t, i) => {
        try {
          return { n: i + 1, data: JSON.parse(t.content ?? ""), error: null };
        } catch (err) {
          return { n: i + 1, data: undefined, error: err.message };
        }
      });
    jsonldCache.set(page, blocks);
  }
  return blocks;
}

/** Blocks that parsed. A block that is not JSON is left to jsonld-parse. */
function parsedBlocks(page) {
  return jsonldBlocks(page).filter((b) => b.error === null);
}

/**
 * Every node (JSON object) in a JSON-LD value, depth-first, with its path
 * from the block root (e.g. "potentialAction", "@graph[1].publisher").
 * @context values and value objects (@value) are not nodes.
 */
function* walkNodes(value, path = "") {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* walkNodes(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Object.hasOwn(value, "@value")) return;
  yield { node: value, path };
  for (const [key, child] of Object.entries(value)) {
    if (key !== "@context") {
      yield* walkNodes(child, path ? `${path}.${key}` : key);
    }
  }
}

/** Every node of every parsed block, nested ones included: [{ block, node, path }]. */
function nodesOf(page) {
  let nodes = nodeCache.get(page);
  if (!nodes) {
    nodes = [];
    for (const block of parsedBlocks(page)) {
      for (const { node, path } of walkNodes(block.data)) {
        nodes.push({ block, node, path });
      }
    }
    nodeCache.set(page, nodes);
  }
  return nodes;
}

/** The top-level nodes of a block: each item, or the members of its @graph. */
function topNodes(data) {
  const items = Array.isArray(data) ? data : [data];
  return items.flatMap((item) => {
    if (isObject(item) && Object.hasOwn(item, "@graph")) {
      const graph = item["@graph"];
      return Array.isArray(graph) ? graph : [graph];
    }
    return [item];
  });
}

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A node's @type names (string or array); "https://schema.org/X" and "schema:X" count as "X". */
function typesOf(node) {
  if (!isObject(node)) return [];
  const raw = node["@type"];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t) => typeof t === "string" && t.trim() !== "")
    .map((t) => t.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, ""));
}

const hasType = (node, type) => typesOf(node).includes(type);

/** Where a node sits, for messages: "block 2" or "block 2, potentialAction". */
const where = (block, path) =>
  path ? `block ${block.n}, ${path}` : `block ${block.n}`;

const SCHEMA_ORG_URL = /^https?:\/\/schema\.org\/?$/i;

/**
 * A schema.org @context: the schema.org URL (http or https, with or without
 * the trailing "/"), an array that holds one, or an object whose @vocab is one.
 */
function isSchemaOrgContext(ctx) {
  if (typeof ctx === "string") return SCHEMA_ORG_URL.test(ctx.trim());
  if (Array.isArray(ctx)) return ctx.some(isSchemaOrgContext);
  if (isObject(ctx)) {
    const vocab = ctx["@vocab"];
    return typeof vocab === "string" && SCHEMA_ORG_URL.test(vocab.trim());
  }
  return false;
}

/** For faq-visible comparisons: NFC, every whitespace character removed, lowercased. */
function compactText(s) {
  return s.normalize("NFC").replace(/\s+/g, "").toLowerCase();
}

/**
 * The page's visible text, compacted: the text of <body> (everything after
 * the <body> tag) minus <script>, <style> and <template>. Text on either side
 * of a tag is joined with nothing in between, then all whitespace is removed,
 * so a question split by <br> or by a block element still matches. Text
 * inside a closed <details> or a [hidden] element counts. No <body> tag: the
 * text after </head>, or the whole document if there is no </head> either.
 */
function visibleText(page) {
  let text = textCache.get(page);
  if (text === undefined) {
    const tokens = tagsOf(page);
    let start = tokens.findIndex(
      (t) =>
        t.type === "open" && t.name === "body" && !t.inForeign && !t.inTemplate,
    );
    if (start === -1) {
      start = tokens.findIndex((t) => t.type === "close" && t.name === "head");
    }
    const parts = [];
    for (const t of tokens.slice(start + 1)) {
      if (t.inTemplate) continue;
      if (t.type === "text") parts.push(decodeEntities(t.text));
      else if (t.type === "open" && RCDATA.has(t.name)) {
        parts.push(t.content ?? ""); // e.g. <textarea>, an SVG <title>
      }
    }
    text = compactText(parts.join(""));
    textCache.set(page, text);
  }
  return text;
}

/** The text of every <loc> in a sitemap, entity-decoded and trimmed. */
function readLocs(xml) {
  const locs = [];
  for (const m of xml.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc\s*>/g)) {
    const body = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
    const loc = decodeEntities(body).trim();
    if (loc) locs.push(loc);
  }
  return locs;
}

export {
  RCDATA,
  compactText,
  decodeEntities,
  elements,
  hasType,
  isObject,
  isSchemaOrgContext,
  jsonldBlocks,
  linksByRel,
  makePage,
  metaByName,
  nodesOf,
  parsedBlocks,
  readLocs,
  readTags,
  relTokens,
  tagsOf,
  topNodes,
  typesOf,
  visibleText,
  walkNodes,
  where,
};
