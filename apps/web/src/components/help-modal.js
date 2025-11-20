export class HelpModal {
    options;
    isOpen = false;
    modal;
    trigger = null;
    constructor(options = {}) {
        this.options = {
            triggerSelector: '#btn-help',
            content: '',
            theme: 'auto',
            ...options
        };
        this.modal = this.createModal();
        this.bindEvents();
    }
    static init(options) {
        return new HelpModal(options);
    }
    open() {
        if (this.isOpen)
            return;
        this.isOpen = true;
        this.modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        const closeBtn = this.modal.querySelector('.modal-close');
        closeBtn?.focus();
        this.trigger?.dispatchEvent(new CustomEvent('helpModal:open', { detail: this }));
    }
    close() {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this.modal.style.display = 'none';
        document.body.style.overflow = '';
        this.trigger?.focus();
        this.trigger?.dispatchEvent(new CustomEvent('helpModal:close', { detail: this }));
    }
    updateContent(content) {
        const body = this.modal.querySelector('.modal-body');
        if (body) {
            body.innerHTML = content;
        }
    }
    createModal() {
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
    bindEvents() {
        this.trigger = document.querySelector(this.options.triggerSelector);
        if (!this.trigger) {
            console.warn(`Help trigger "${this.options.triggerSelector}" not found`);
            return;
        }
        this.trigger.addEventListener('click', (event) => {
            event.preventDefault();
            this.open();
        });
        const closeBtn = this.modal.querySelector('.modal-close');
        closeBtn?.addEventListener('click', () => this.close());
        const backdrop = this.modal.querySelector('.modal-backdrop');
        backdrop?.addEventListener('click', () => this.close());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
        this.modal.addEventListener('click', (event) => {
            const target = event.target;
            if (target.matches('a[href^="#"]')) {
                event.preventDefault();
                const id = target.getAttribute('href')?.substring(1);
                const section = id ? this.modal.querySelector(`#${id}`) : null;
                section?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
}
