// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { dropdownSupportsGroups } from './ds-loader';
import type { DropdownCtor, ModalCtor, SplitPanelCtor } from './ds-loader';
import { flattenGroupedItems } from './model-catalog';

/**
 * Contract tests against the real design-system submodule: they construct each
 * component the way the editor does, so a submodule bump that changes an API
 * the editor relies on fails here instead of in the browser.
 */
const component = async <T>(relativePath: string): Promise<T> => {
    // Kept as two steps so Vite does not treat this as a bundled asset URL.
    const testFileUrl: string = import.meta.url;
    const moduleUrl = new URL(`../../../../design-system/components/${relativePath}`, testFileUrl).href;
    return ((await import(/* @vite-ignore */ moduleUrl)) as { default: T }).default;
};

describe('design-system components used by the editor', () => {
    it('dropdown: renders items, reports selection and removes its document listeners on destroy', async () => {
        const Dropdown = await component<DropdownCtor>('dropdown/dropdown.js');
        const added = vi.spyOn(document, 'addEventListener');
        const removed = vi.spyOn(document, 'removeEventListener');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onSelect = vi.fn();

        const dropdown = new Dropdown(container, {
            placeholder: 'Select model',
            items: [
                { value: 'gpt-5', label: 'GPT-5' },
                { value: 'gpt-5-mini', label: 'GPT-5 Mini' }
            ],
            selectedValue: 'gpt-5',
            width: '100%',
            onSelect
        });

        expect(container.textContent).toContain('GPT-5');
        const options = container.querySelectorAll<HTMLElement>('[role="option"]');
        expect(options).toHaveLength(2);
        options[1].click();
        expect(onSelect).toHaveBeenCalledWith('gpt-5-mini', expect.anything());

        expect(typeof dropdown.destroy).toBe('function');
        dropdown.destroy?.();
        const documentListeners = added.mock.calls.map(([type, listener]) => ({ type, listener }));
        for (const { type, listener } of documentListeners) {
            expect(removed.mock.calls.some(([t, l]) => t === type && l === listener)).toBe(true);
        }
        added.mockRestore();
        removed.mockRestore();
    });

    it('dropdown: grouped model items render with headings, or with prefixed labels before group support', async () => {
        const Dropdown = await component<DropdownCtor>('dropdown/dropdown.js');
        const grouped = [
            { label: 'OpenAI', items: [{ value: 'gpt-a', label: 'GPT A' }] },
            { label: 'Anthropic', items: [{ value: 'claude-a', label: 'Claude A' }] }
        ];
        const supportsGroups = dropdownSupportsGroups(Dropdown);
        const container = document.createElement('div');
        document.body.appendChild(container);

        const dropdown = new Dropdown(container, {
            placeholder: 'Select model',
            items: supportsGroups ? grouped : flattenGroupedItems(grouped),
            selectedValue: 'claude-a',
            width: '100%',
            onSelect: () => {}
        });

        const optionLabels = Array.from(container.querySelectorAll('[role="option"]')).map((o) => o.textContent?.trim());
        const headings = Array.from(container.querySelectorAll('[role="group"]')).map((group) =>
            document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent
        );
        if (supportsGroups) {
            expect(headings).toEqual(['OpenAI', 'Anthropic']);
            expect(optionLabels).toEqual(['GPT A', 'Claude A']);
        } else {
            expect(headings).toEqual([]);
            expect(optionLabels).toEqual(['OpenAI · GPT A', 'Anthropic · Claude A']);
        }
        dropdown.destroy?.();
    });

    it('modal: opens, runs footer button handlers and closes', async () => {
        const Modal = await component<ModalCtor>('modal/modal.js');
        const content = document.createElement('p');
        content.textContent = 'Clear the canvas?';
        const onClose = vi.fn();

        const modal = new Modal({
            size: 'small',
            title: 'Confirm',
            content,
            footerButtons: [
                { label: 'Cancel', type: 'secondary', onClick: (_event, instance) => instance.close() },
                { label: 'Clear', type: 'primary', onClick: (_event, instance) => instance.close() }
            ],
            onClose
        });
        modal.open();

        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain('Clear the canvas?');
        const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === 'Clear');
        confirm?.click();
        expect(onClose).toHaveBeenCalledTimes(1);
        modal.destroy();

        expect(typeof Modal.createHelpModal).toBe('function');
        const help = Modal.createHelpModal({ title: 'Help / User Guide', content: '<h2>Guide</h2>' });
        expect(typeof help.open).toBe('function');
        help.destroy();
    });

    it('split panel: exposes both panels and a named divider', async () => {
        // jsdom has no ResizeObserver; the component only uses it to re-apply the split.
        vi.stubGlobal('ResizeObserver', class {
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
        });
        const SplitPanel = await component<SplitPanelCtor>('split-panel/split-panel.js');
        const layout = document.createElement('div');
        document.body.appendChild(layout);

        const split = new SplitPanel(layout, { initialSplit: 70, minLeft: 30, minRight: 20, dividerLabel: 'Resize run console' });

        expect(split.getLeftPanel()).toBeInstanceOf(HTMLElement);
        expect(split.getRightPanel()).toBeInstanceOf(HTMLElement);
        expect(layout.querySelector('[aria-label="Resize run console"]')).not.toBeNull();
        vi.unstubAllGlobals();
    });
});
