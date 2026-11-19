import type { ConfirmOptions } from './types';

export type DropdownItem = {
    value: string;
    label: string;
    /** Group heading for the item. Needs a design-system dropdown with group support. */
    group?: string;
};

export type DropdownConfig = {
    placeholder: string;
    items: DropdownItem[];
    selectedValue: string;
    width: string;
    onSelect: (value: string) => void;
};

export type DropdownInstance = {
    destroy?: () => void;
};

export type DropdownCtor = new (container: HTMLElement, config: DropdownConfig) => DropdownInstance;

/** Whether this design-system dropdown renders `group` headings (added after the pinned 2026-10 version). */
export function dropdownSupportsGroups(ctor: DropdownCtor): boolean {
    return typeof (ctor.prototype as { createGroup?: unknown }).createGroup === 'function';
}

export type SplitPanelInstance = {
    getLeftPanel: () => HTMLElement;
    getRightPanel: () => HTMLElement;
};

export type SplitPanelCtor = new (
    container: Element,
    options: { initialSplit: number; minLeft: number; minRight: number; dividerLabel?: string }
) => SplitPanelInstance;

export type ModalInstance = {
    open: () => void;
    close: () => void;
    destroy: () => void;
};

type ModalFooterButton = {
    label: string;
    type: 'primary' | 'secondary';
    onClick: (_event: Event, instance: ModalInstance) => void;
};

export type ModalCtor = (new (options: {
    size: 'small' | 'medium' | 'large';
    title: string;
    content: HTMLElement;
    footerButtons: ModalFooterButton[];
    onClose: () => void;
}) => ModalInstance) & {
    createHelpModal: (options: { title: string; content: string }) => ModalInstance;
};

const componentCache = new Map<string, Promise<unknown>>();

/**
 * Loads a design-system component module (served from the `design-system`
 * submodule under `/design-system/`) and returns its default export.
 */
function loadDesignSystemComponent<T>(componentPath: string): Promise<T> {
    let pending = componentCache.get(componentPath);
    if (!pending) {
        const modulePath = `${window.location.origin}/design-system/components/${componentPath}`;
        pending = import(/* @vite-ignore */ modulePath).then(
            (mod) => (mod as { default: T }).default
        );
        // A failed load must not be cached, or the component could never recover.
        pending.catch(() => componentCache.delete(componentPath));
        componentCache.set(componentPath, pending);
    }
    return pending as Promise<T>;
}

export function getDropdownCtor(): Promise<DropdownCtor> {
    return loadDesignSystemComponent<DropdownCtor>('dropdown/dropdown.js');
}

export function getSplitPanelCtor(): Promise<SplitPanelCtor> {
    return loadDesignSystemComponent<SplitPanelCtor>('split-panel/split-panel.js');
}

export function getModalCtor(): Promise<ModalCtor> {
    return loadDesignSystemComponent<ModalCtor>('modal/modal.js');
}

export async function openConfirmModal(options: ConfirmOptions = {}): Promise<boolean> {
    const {
        title = 'Confirm',
        message = 'Are you sure?',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel'
    } = options;

    try {
        const ModalCtor = await getModalCtor();
        const content = document.createElement('p');
        content.textContent = message;

        return await new Promise<boolean>((resolve) => {
            let confirmed = false;

            const modal = new ModalCtor({
                size: 'small',
                title,
                content,
                footerButtons: [
                    {
                        label: cancelLabel,
                        type: 'secondary',
                        onClick: (_event, instance) => instance.close()
                    },
                    {
                        label: confirmLabel,
                        type: 'primary',
                        onClick: (_event, instance) => {
                            confirmed = true;
                            instance.close();
                        }
                    }
                ],
                onClose: () => {
                    modal.destroy();
                    resolve(confirmed);
                }
            });

            modal.open();
        });
    } catch (error) {
        console.warn('Failed to initialize DS confirm modal', error);
        return window.confirm(message);
    }
}
