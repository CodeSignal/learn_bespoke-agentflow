import './workflow-editor.css';

import { getModalCtor } from './app/ds-loader';
import WorkflowEditor from './app/workflow-editor';
import { helpContent } from './data/help-content';

declare global {
  interface Window {
    editor?: WorkflowEditor;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.editor = new WorkflowEditor();
  const helpTrigger = document.getElementById('btn-help');
  if (!helpTrigger) return;

  getModalCtor()
    .then((Modal) => {
      const helpModal = Modal.createHelpModal({
        title: 'Help / User Guide',
        content: helpContent
      });

      helpTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        helpModal.open();
      });
    })
    .catch((error) => {
      console.warn('Failed to initialize DS help modal', error);
    });
});
