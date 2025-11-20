export interface HelpModalOptions {
  triggerSelector?: string;
  content?: string;
  theme?: 'auto' | 'light' | 'dark';
}

export class HelpModal {
  private options: Required<HelpModalOptions>;

  private isOpen = false;

  private modal: HTMLDivElement;

  private trigger: HTMLElement | null = null;

  constructor(options: HelpModalOptions = {}) {
    this.options = {
      triggerSelector: '#btn-help',
      content: '',
      theme: 'auto',
      ...options
    };

    this.modal = this.createModal();
    this.bindEvents();
  }

  static init(options: HelpModalOptions) {
    return new HelpModal(options);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const closeBtn = this.modal.querySelector<HTMLButtonElement>('.modal-close');
    closeBtn?.focus();
    this.trigger?.dispatchEvent(new CustomEvent('helpModal:open', { detail: this }));
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.modal.style.display = 'none';
    document.body.style.overflow = '';
    this.trigger?.focus();
    this.trigger?.dispatchEvent(new CustomEvent('helpModal:close', { detail: this }));
  }

  updateContent(content: string) {
    const body = this.modal.querySelector('.modal-body');
    if (body) {
      body.innerHTML = content;
    }
  }

  private createModal(): HTMLDivElement {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Help / User Guide</h2>
          <button class="modal-close" type="button" aria-label="Close help">×</button>
        </div>
        <div class="modal-body">${this.options.content}</div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  private bindEvents() {
    this.trigger = document.querySelector<HTMLElement>(this.options.triggerSelector);
    if (!this.trigger) {
      console.warn(`Help trigger "${this.options.triggerSelector}" not found`);
      return;
    }

    this.trigger.addEventListener('click', (event) => {
      event.preventDefault();
      this.open();
    });

    const closeBtn = this.modal.querySelector<HTMLButtonElement>('.modal-close');
    closeBtn?.addEventListener('click', () => this.close());

    const backdrop = this.modal.querySelector<HTMLDivElement>('.modal-backdrop');
    backdrop?.addEventListener('click', () => this.close());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    this.modal.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.matches('a[href^="#"]')) {
        event.preventDefault();
        const id = target.getAttribute('href')?.substring(1);
        const section = id ? this.modal.querySelector(`#${id}`) : null;
        section?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }
}

