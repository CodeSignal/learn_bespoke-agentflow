import './workflow-editor.css';

import WorkflowEditor from './app/workflow-editor';
import { HelpModal } from './components/help-modal';
import { helpContent } from './data/help-content';

declare global {
  interface Window {
    editor?: WorkflowEditor;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.editor = new WorkflowEditor();
  HelpModal.init({ content: helpContent });
});
