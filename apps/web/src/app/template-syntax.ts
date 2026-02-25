/**
 * Syntax highlighting for {{VARIABLE_NAME}} template tokens in prompt fields.
 * Reuses markdown.escapeHtml; styling uses design-system tokens in workflow-editor.css.
 */

import { escapeHtml } from './markdown';

/** Match {{IDENTIFIER}} - optional spaces around name, identifier non-empty, no nested braces. */
const TEMPLATE_VAR_REGEX = /\{\{\s*([^}]+)\s*\}\}/g;

/**
 * Returns HTML with {{...}} wrapped in <span class="template-var"> for highlighting.
 * Rest of text is escaped for safe innerHTML use.
 */
export function highlightTemplateVars(text: string): string {
    const escaped = escapeHtml(text);
    return escaped.replace(TEMPLATE_VAR_REGEX, (_m, inner: string) =>
        `<span class="template-var">{{${inner.trim()}}}</span>`
    );
}

/**
 * Wraps {{...}} in already-rendered HTML with <span class="template-var"> for highlighting.
 * Use after renderMarkdown() so agent output shows template vars like the agent settings.
 */
export function wrapTemplateVarsInHtml(html: string): string {
    return html.replace(TEMPLATE_VAR_REGEX, (_m, inner: string) =>
        `<span class="template-var">{{${inner.trim()}}}</span>`
    );
}

/** Private-use Unicode range for placeholders (single chars markdown won't alter). */
const TEMPLATE_PLACEHOLDER_BASE = 0xe000;

/**
 * Replaces {{...}} with single-char placeholders so markdown doesn't parse inside them
 * (e.g. _ in PREVIOUS_OUTPUT would become italics). Returns protected text and list of
 * full placeholder strings for later restore.
 */
export function protectTemplateVarsForMarkdown(text: string): { protected: string; placeholders: string[] } {
    const placeholders: string[] = [];
    let index = 0;
    const protectedText = text.replace(TEMPLATE_VAR_REGEX, (fullMatch: string) => {
        placeholders.push(fullMatch);
        return String.fromCharCode(TEMPLATE_PLACEHOLDER_BASE + index++);
    });
    return { protected: protectedText, placeholders };
}

/**
 * Restores placeholder chars in markdown HTML with <span class="template-var">...</span>.
 * placeholders[i] is the full "{{VAR}}" string for the i-th placeholder char.
 */
export function restoreTemplateVarsInHtml(html: string, placeholders: string[]): string {
    let out = html;
    placeholders.forEach((fullMatch, i) => {
        const ch = String.fromCharCode(TEMPLATE_PLACEHOLDER_BASE + i);
        const span = `<span class="template-var">${escapeHtml(fullMatch)}</span>`;
        out = out.split(ch).join(span);
    });
    return out;
}

/**
 * Wraps a textarea in a container with an overlay that shows {{VARIABLE_NAME}} highlighted.
 * Syncs content and scroll. Call once per textarea.
 */
export function attachTemplateHighlightOverlay(textarea: HTMLTextAreaElement): void {
    const parent = textarea.parentElement;
    if (!parent) return;

    // Capture the textarea's original text color before we wrap it (wrapper makes text transparent).
    const originalTextColor = getComputedStyle(textarea).color;

    const wrapper = document.createElement('div');
    wrapper.className = 'template-highlight-wrapper';

    const overlay = document.createElement('div');
    overlay.className = 'template-highlight-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    parent.insertBefore(wrapper, textarea);
    wrapper.appendChild(overlay);
    wrapper.appendChild(textarea);

    const syncOverlayContent = (): void => {
        overlay.innerHTML = highlightTemplateVars(textarea.value);
    };

    const syncScroll = (): void => {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
    };

    const copyTextareaStyles = (): void => {
        const cs = getComputedStyle(textarea);
        overlay.style.color = originalTextColor;
        overlay.style.fontFamily = cs.fontFamily;
        overlay.style.fontSize = cs.fontSize;
        overlay.style.fontWeight = cs.fontWeight;
        overlay.style.lineHeight = cs.lineHeight;
        overlay.style.letterSpacing = cs.letterSpacing;
        overlay.style.padding = cs.padding;
        overlay.style.border = 'none';
        overlay.style.width = cs.width;
        overlay.style.minHeight = cs.minHeight;
    };

    copyTextareaStyles();
    syncOverlayContent();

    textarea.addEventListener('input', () => {
        syncOverlayContent();
    });
    textarea.addEventListener('scroll', syncScroll);

    const ro = new ResizeObserver(() => {
        copyTextareaStyles();
        syncOverlayContent();
    });
    ro.observe(textarea);
}
