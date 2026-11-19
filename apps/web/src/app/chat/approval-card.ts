import type { ApprovalDecision } from '../types';

export type ApprovalRequestCard = {
    container: HTMLElement;
    approveBtn: HTMLButtonElement;
    rejectBtn: HTMLButtonElement;
};

/** Turns `container` into the "Approved"/"Rejected" result card. */
export function renderApprovalResultCard(container: HTMLElement, decision: ApprovalDecision, note: string = ''): void {
    container.className = 'chat-message approval-result';
    container.classList.add(decision === 'approve' ? 'approved' : 'rejected');

    const trimmedNote = (note || '').trim();
    const icon = decision === 'approve' ? '✓' : '✗';
    const text = decision === 'approve' ? 'Approved' : 'Rejected';

    container.innerHTML = '';

    const labelEl = document.createElement('span');
    labelEl.className = 'chat-message-label';
    labelEl.textContent = 'Approval decision';
    container.appendChild(labelEl);

    const content = document.createElement('div');
    content.className = 'approval-result-content';

    const status = document.createElement('div');
    status.className = 'approval-result-status';

    const iconEl = document.createElement('span');
    iconEl.className = 'approval-result-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;
    status.appendChild(iconEl);

    const textEl = document.createElement('span');
    textEl.className = 'approval-result-text';
    textEl.textContent = text;
    status.appendChild(textEl);

    content.appendChild(status);

    if (trimmedNote) {
        const noteEl = document.createElement('div');
        noteEl.className = 'approval-result-note';
        noteEl.textContent = trimmedNote;
        content.appendChild(noteEl);
    }

    container.appendChild(content);
}

/** Builds the card that asks the user to approve or reject. */
export function buildApprovalRequestCard(
    messageText: string,
    onDecision: (decision: ApprovalDecision) => void
): ApprovalRequestCard {
    const message = document.createElement('div');
    message.className = 'chat-message approval-request';

    const labelEl = document.createElement('span');
    labelEl.className = 'chat-message-label';
    labelEl.textContent = 'Approval required';
    message.appendChild(labelEl);

    const body = document.createElement('div');
    body.className = 'approval-body';

    const textEl = document.createElement('div');
    textEl.className = 'approval-text';
    textEl.textContent = messageText;
    body.appendChild(textEl);

    const helperEl = document.createElement('div');
    helperEl.className = 'approval-helper';
    helperEl.textContent = 'Choose how this workflow should proceed.';
    body.appendChild(helperEl);

    const actions = document.createElement('div');
    actions.className = 'approval-actions';

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'button button-secondary reject-btn';
    rejectBtn.textContent = 'Reject';

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'button button-primary approve-btn';
    approveBtn.textContent = 'Approve';

    rejectBtn.addEventListener('click', () => onDecision('reject'));
    approveBtn.addEventListener('click', () => onDecision('approve'));

    actions.appendChild(rejectBtn);
    actions.appendChild(approveBtn);
    body.appendChild(actions);
    message.appendChild(body);

    return { container: message, approveBtn, rejectBtn };
}

/** Reads the decision and feedback back out of an `input_received` log line. */
export function parseApprovalInputLog(content: string): { decision: ApprovalDecision; note: string } {
    const decisionPrefixMatch = content.match(/(?:^|\n)\s*(?:Decision|Status)\s*:\s*(approve|approved|reject|rejected)\b/i);
    const sentencePrefixMatch = content.match(/(?:^|\n)\s*User\s+(approved|rejected)\b/i);
    const rawDecision = (decisionPrefixMatch?.[1] || sentencePrefixMatch?.[1] || 'approve').toLowerCase();
    const decision = rawDecision.startsWith('reject') ? 'reject' : 'approve';
    const feedbackMatch = content.match(/feedback:\s*(.*)$/i);
    const note = feedbackMatch?.[1]?.trim() || '';
    return { decision, note };
}
