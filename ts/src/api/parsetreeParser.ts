/**
 * Parsetree XML parser — extracts structured template data from MediaWiki
 * `action=parse&prop=parsetree` output.
 *
 * Split out of `endfieldWiki.ts` so the wiki client stays under the file-size
 * guard (see `docs/dev/STYLE.md`). This module is a self-contained,
 * network-free, side-effect-free pure function over a string — exactly the
 * kind of unit that earns its own file: deep nesting in the original,
 * independently testable, and consumed by exactly one caller
 * (`getTemplateData`) via a single narrow entry point.
 *
 * Ported verbatim from PRTS-MCP's `ts/src/api/prtsWiki.ts` parsetree block;
 * the MediaWiki parsetree XML shape is game-agnostic.
 */

// ---------------------------------------------------------------------------
// Top-level <template> tag splitter
// ---------------------------------------------------------------------------

/**
 * Yield each top-level `<tag>...</tag>` substring from `xml`, respecting
 * nesting. Self-nesting tags (templates inside templates) are returned as a
 * single outermost span so callers see one entry per top-level template.
 */
function* splitTopLevelTags(xml: string, tag: string): Generator<string> {
  const open = `<${tag}`;
  const close = `</${tag}>`;

  let depth = 0;
  let start = 0;

  for (let i = 0; i < xml.length; ) {
    if (xml.startsWith(open, i)) {
      if (depth === 0) start = i;
      depth++;
      i += open.length;
    } else if (xml.startsWith(close, i)) {
      depth--;
      if (depth === 0) {
        yield xml.substring(start, i + close.length);
      }
      i += close.length;
    } else {
      i++;
    }
  }
}

function stripComments(xml: string): string {
  return xml.replace(/<comment>[\s\S]*?<\/comment>/g, "");
}

// ---------------------------------------------------------------------------
// <part> parser — one template parameter per <part>
// ---------------------------------------------------------------------------

const PART_RE = /<part>([\s\S]*?)<\/part>/g;
const NAME_RE = /<name[^>]*>([\s\S]*?)<\/name>/;
const VALUE_RE = /<value>([\s\S]*?)<\/value>/;
const INDEX_RE = /\bindex\s*=/;

interface ParsedPart {
  key?: string;
  value: string;
}

function parsePart(partXml: string): ParsedPart | null {
  const nameMatch = partXml.match(NAME_RE);
  const valueMatch = partXml.match(VALUE_RE);
  if (!valueMatch?.[1]) return null;
  // Strip nested template tags from the value
  const raw = valueMatch[1].replace(/<template[\s\S]*?<\/template>/g, "");
  const value = raw.trim();
  if (!value) return null;
  if (nameMatch) {
    const nameText = nameMatch[1].replace(/<[^>]+>/g, "").trim();
    if (!nameText && INDEX_RE.test(partXml)) return { value }; // positional (index=N)
    if (nameText) return { key: nameText, value };
  }
  return { value };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a MediaWiki parsetree XML document into a map of template name →
 * fields. Each template becomes:
 *
 *   - Named parameters (`{{T|key=value}}`) → top-level keys.
 *   - Positional parameters (`{{T|value1|value2}}`) → `_positional` array.
 *   - The template's own `<!-- comment -->` → `_comment` string.
 *
 * Templates with no extractable fields are omitted. When multiple templates
 * share the same name, the last one wins (matches MediaWiki semantics where
 * later invocations override earlier display output).
 *
 * @param xml The raw `parsetree["*"]` string from `action=parse&prop=parsetree`.
 * @returns Map keyed by template title (whitespace-trimmed, newlines removed).
 */
export function parseParsetreeXml(
  xml: string,
): Record<string, Record<string, unknown>> {
  const templates: Record<string, Record<string, unknown>> = {};

  for (const tXml of splitTopLevelTags(xml, "template")) {
    const titleMatch = tXml.match(/<title>([\s\S]*?)<\/title>/);
    if (!titleMatch) continue;

    const title = stripComments(titleMatch[1]).replace(/\n/g, "").trim();
    if (!title) continue;

    const commentMatch = tXml.match(/<comment>([\s\S]*?)<\/comment>/);
    const comment = commentMatch?.[1]?.trim() ?? "";

    const kv: Record<string, string> = {};
    const positional: string[] = [];

    let pMatch: RegExpExecArray | null;
    PART_RE.lastIndex = 0;
    while ((pMatch = PART_RE.exec(tXml)) !== null) {
      const parsed = parsePart(pMatch[1]);
      if (!parsed) continue;
      if (parsed.key) {
        kv[parsed.key] = parsed.value;
      } else {
        positional.push(parsed.value);
      }
    }

    const entry: Record<string, unknown> = {};
    if (Object.keys(kv).length > 0) Object.assign(entry, kv);
    if (positional.length > 0) entry._positional = positional;
    if (comment) entry._comment = comment;

    if (Object.keys(entry).length > 0) {
      templates[title] = entry;
    }
  }

  return templates;
}
