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

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

interface FootnoteCtx {
    map: Map<string, string>;   // id → definition text
    order: string[];            // ids in first-reference order
}

function renderInline(raw: string, fn?: FootnoteCtx): string {
    let out = escapeHtml(raw);

    // Inline code (process before bold/italic so content isn't altered)
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Footnote references [^id]
    if (fn) {
        out = out.replace(/\[\^([^\]]+)\]/g, (_m, id: string) => {
            const key = id.trim();
            if (!fn.order.includes(key)) fn.order.push(key);
            const n = fn.order.indexOf(key) + 1;
            return `<sup class="md-fn-ref" id="fnref-${key}">${n}</sup>`;
        });
    }

    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic
    out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    out = out.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    // Links
    out = out.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

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
    const rows = tableLines.slice(2).map(parseRow);

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
            result.push(l.replace(/^\s{2,}|\t/, ''));
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
    // --- Pass 1: extract footnote definitions ---
    const fn: FootnoteCtx = { map: new Map(), order: [] };
    const withoutFootnoteDefs = input.replace(
        /^\[\^([^\]]+)\]:\s*(.+)$/gm,
        (_m, id: string, def: string) => {
            fn.map.set(id.trim(), def.trim());
            return '';
        }
    );

    // --- Pass 2: extract fenced code blocks ---
    const codeBlocks: string[] = [];
    const withPlaceholders = withoutFootnoteDefs.replace(
        /```(\w*)\n?([\s\S]*?)```/g,
        (_m, _lang, code: string) => {
            const idx = codeBlocks.length;
            codeBlocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
            return `\x00CODE${idx}\x00`;
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
        const codeMatch = trimmed.match(/^\x00CODE(\d+)\x00$/);
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
            !/^\x00CODE/.test(lines[i])
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
