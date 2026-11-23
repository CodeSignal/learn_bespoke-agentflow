/**
 * Minimal markdown renderer for LLM chat messages.
 *
 * Supports: bold, italic, inline code, fenced code blocks, links,
 * unordered/ordered lists (with nesting), headings, blockquotes,
 * GFM tables, footnotes, hr.
 *
 * Uses <div> for paragraphs instead of <p> to avoid browser UA
 * default margin-block that bleeds through CSS resets.
 * Spacing is handled entirely via flex gap on the parent container.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Reverses `escapeHtml`. */
function unescapeHtml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

interface FootnoteCtx {
    map: Map<string, string>;   // id → definition text
    order: string[];            // ids in first-reference order
}

const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * Returns the URL when it is safe to use as a link target, otherwise null.
 * Only http, https and mailto links are allowed; anything else (javascript:,
 * data:, relative paths, unknown schemes) is rejected. Control characters and
 * whitespace are removed first because browsers ignore them inside a scheme.
 */
export function sanitizeLinkUrl(rawUrl: string): string | null {
    const cleaned = rawUrl.replace(/[\u0000-\u0020\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');
    const schemeMatch = cleaned.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (!schemeMatch) return null;
    if (!ALLOWED_LINK_PROTOCOLS.includes(`${schemeMatch[1].toLowerCase()}:`)) return null;
    return cleaned;
}

// Private-use delimiters for text that must not be touched by later inline rules.
const HOLD_OPEN = '\uE001';
const HOLD_CLOSE = '\uE002';
const HOLD_PATTERN = /\uE001(\d+)\uE002/g;
const HOLD_TEST = /\uE001\d+\uE002/;
const HOLD_CHARS = /[\uE001\uE002]/g;
// Includes the code-block placeholder delimiter used by renderMarkdown.
const RESERVED_CHARS = /[\uE000-\uE002]/g;

function renderInline(raw: string, fn?: FootnoteCtx): string {
    // Finished HTML fragments (code spans, links) are held aside so the emphasis
    // rules below cannot rewrite their contents, then put back at the end.
    const held: string[] = [];
    const hold = (html: string): string => {
        held.push(html);
        return `${HOLD_OPEN}${held.length - 1}${HOLD_CLOSE}`;
    };

    const emphasis = (text: string): string => {
        let out = text;
        // Bold
        out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^\p{L}\p{N}_])__(?=\S)(.+?)__(?![\p{L}\p{N}_])/gu, '$1<strong>$2</strong>');
        // Italic. Underscores only count at word boundaries, so snake_case
        // identifiers and URLs are left alone.
        out = out.replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, '<em>$1</em>');
        out = out.replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>');
        return out;
    };

    let out = escapeHtml(raw.replace(HOLD_CHARS, ''));

    // Inline code first: its content is shown literally.
    out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`<code>${code}</code>`));

    // Links. URL capture allows one level of balanced parentheses so that links like
    // https://en.wikipedia.org/wiki/Rust_(programming_language) work correctly.
    // A link whose URL is not allowed is rendered as plain text.
    out = out.replace(
        /\[([^\]]+)\]\(((?:[^()\s]|\([^)]*\))+)\)/g,
        (_m, linkText: string, href: string) => {
            // `href` is already HTML-escaped; validate the real URL, then escape it once.
            const safeHref = sanitizeLinkUrl(unescapeHtml(href));
            const label = emphasis(linkText);
            if (!safeHref) return label;
            return hold(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
        }
    );

    // Footnote references [^id]
    if (fn) {
        out = out.replace(/\[\^([^\]]+)\]/g, (_m, id: string) => {
            const key = id.trim();
            if (!fn.order.includes(key)) fn.order.push(key);
            const n = fn.order.indexOf(key) + 1;
            return hold(`<sup class="md-fn-ref" id="fnref-${key}">${n}</sup>`);
        });
    }

    out = emphasis(out);

    // Put the held fragments back (a held link label can itself hold a code span).
    while (HOLD_TEST.test(out)) {
        out = out.replace(HOLD_PATTERN, (_m, index: string) => held[Number(index)] ?? '');
    }
    return out;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderTable(tableLines: string[], fn: FootnoteCtx): string {
    const parseRow = (line: string): string[] =>
        line.split('|').slice(1, -1).map((c) => c.trim());

    const headers = parseRow(tableLines[0]);
    // tableLines[1] is the separator row — skip it
    // Normalize each row to exactly headers.length cells (pad or truncate)
    const rows = tableLines.slice(2).map((line) => {
        const cells = parseRow(line);
        while (cells.length < headers.length) cells.push('');
        return cells.slice(0, headers.length);
    });

    const thead =
        `<thead><tr>${headers
            .map((h) => `<th>${renderInline(h, fn)}</th>`)
            .join('')}</tr></thead>`;

    const tbody =
        `<tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, fn)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`;

    return `<table>${thead}${tbody}</table>`;
}

// ---------------------------------------------------------------------------
// Nested list (recursive)
// ---------------------------------------------------------------------------

const UL_MARKER = /^[-*+]\s+/;
const OL_MARKER = /^\d+\.\s+/;
const INDENT_UL = /^(?:\s{2,}|\t)[-*+]\s+/;
const INDENT_OL = /^(?:\s{2,}|\t)\d+\.\s+/;

function collectList(
    lines: string[],
    startIdx: number,
    marker: RegExp,
    strip: RegExp,
    tag: 'ul' | 'ol',
    fn: FootnoteCtx
): { html: string; next: number } {
    const items: string[] = [];
    let i = startIdx;

    while (i < lines.length) {
        const l = lines[i];

        // Skip blank lines between items if the next non-blank line continues the list
        if (!l.trim()) {
            const next = lines[i + 1] ?? '';
            if (marker.test(next)) { i++; continue; }
            break;
        }

        if (!marker.test(l)) break;

        const itemText = renderInline(l.replace(strip, ''), fn);
        i++;

        // Look for indented sub-list immediately following this item
        let nested = '';
        if (i < lines.length) {
            if (INDENT_UL.test(lines[i])) {
                const subLines = collectIndented(lines, i);
                i += subLines.length;
                const result = collectList(subLines, 0, UL_MARKER, UL_MARKER, 'ul', fn);
                nested = result.html;
            } else if (INDENT_OL.test(lines[i])) {
                const subLines = collectIndented(lines, i);
                i += subLines.length;
                const result = collectList(subLines, 0, OL_MARKER, OL_MARKER, 'ol', fn);
                nested = result.html;
            }
        }

        items.push(`<li>${itemText}${nested}</li>`);
    }

    return { html: `<${tag}>${items.join('')}</${tag}>`, next: i };
}

/** Pull consecutive indented lines (2+ spaces or tab prefix) and strip one level of indent. */
function collectIndented(lines: string[], startIdx: number): string[] {
    const result: string[] = [];
    let i = startIdx;
    while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
            // Include blank lines only if the next line is still indented
            const next = lines[i + 1] ?? '';
            if (INDENT_UL.test(next) || INDENT_OL.test(next)) {
                result.push('');
                i++;
                continue;
            }
            break;
        }
        if (INDENT_UL.test(l) || INDENT_OL.test(l)) {
            result.push(l.replace(/^(?:  |\t)/, ''));
            i++;
        } else {
            break;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderMarkdown(input: string): string {
    // --- Pass 1: extract fenced code blocks ---
    // Done first so nothing inside a code block is read as markdown.
    const codeBlocks: string[] = [];
    const withCodePlaceholders = input.replace(RESERVED_CHARS, '').replace(
        /```(\w*)\n?([\s\S]*?)```/g,
        (_m, _lang, code: string) => {
            const idx = codeBlocks.length;
            codeBlocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
            return `\uE000CODE${idx}\uE000`;
        }
    );

    // --- Pass 2: extract footnote definitions ---
    const fn: FootnoteCtx = { map: new Map(), order: [] };
    const withPlaceholders = withCodePlaceholders.replace(
        /^\[\^([^\]]+)\]:\s*(.+)$/gm,
        (_m, id: string, def: string) => {
            fn.map.set(escapeHtml(id.trim()), def.trim());
            return '';
        }
    );

    const lines = withPlaceholders.split('\n');
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trimEnd();

        // Empty line
        if (!trimmed.trim()) { i++; continue; }

        // Code block placeholder
        const codeMatch = trimmed.match(/^\uE000CODE(\d+)\uE000$/);
        if (codeMatch) {
            blocks.push(codeBlocks[Number(codeMatch[1])]);
            i++;
            continue;
        }

        // Heading
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            blocks.push(`<h${level}>${renderInline(headingMatch[2], fn)}</h${level}>`);
            i++;
            continue;
        }

        // Horizontal rule
        if (/^[-*_]{3,}$/.test(trimmed.trim())) {
            blocks.push('<hr>');
            i++;
            continue;
        }

        // Blockquote
        if (/^>\s?/.test(trimmed)) {
            const quoteLines: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                quoteLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            blocks.push(`<blockquote>${renderInline(quoteLines.join(' '), fn)}</blockquote>`);
            continue;
        }

        // Table: current line starts with | and next line is a separator
        if (/^\|/.test(trimmed) && i + 1 < lines.length && /^\|[\s|:-]+\|/.test(lines[i + 1])) {
            const tableLines: string[] = [];
            while (i < lines.length && /^\|/.test(lines[i].trim())) {
                tableLines.push(lines[i]);
                i++;
            }
            if (tableLines.length >= 2) {
                blocks.push(renderTable(tableLines, fn));
            }
            continue;
        }

        // Unordered list
        if (UL_MARKER.test(trimmed)) {
            const result = collectList(lines, i, UL_MARKER, UL_MARKER, 'ul', fn);
            blocks.push(result.html);
            i = result.next;
            continue;
        }

        // Ordered list
        if (OL_MARKER.test(trimmed)) {
            const result = collectList(lines, i, OL_MARKER, OL_MARKER, 'ol', fn);
            blocks.push(result.html);
            i = result.next;
            continue;
        }

        // Paragraph — collect consecutive non-special lines
        const paraLines: string[] = [];
        while (
            i < lines.length &&
            lines[i].trimEnd() &&
            !/^(#{1,4}|>|[-*+]|\d+\.)\s/.test(lines[i]) &&
            !/^[-*_]{3,}$/.test(lines[i].trim()) &&
            !/^\|/.test(lines[i].trim()) &&
            !/^\uE000CODE/.test(lines[i])
        ) {
            paraLines.push(lines[i]);
            i++;
        }
        if (paraLines.length > 0) {
            blocks.push(`<div>${renderInline(paraLines.join(' '), fn)}</div>`);
        }
    }

    // --- Pass 3: append footnote definitions section ---
    if (fn.order.length > 0) {
        const items = fn.order.map((id, idx) => {
            const def = fn.map.get(id) ?? '';
            return `<li id="fn-${id}">${idx + 1}. ${renderInline(def, fn)}</li>`;
        });
        blocks.push(`<div class="md-footnotes"><hr><ol>${items.join('')}</ol></div>`);
    }

    return blocks.join('');
}
