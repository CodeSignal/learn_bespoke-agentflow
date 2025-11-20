import './bespoke.css';
import './workflow-editor.css';
import WorkflowEditor from './app/workflow-editor';
import { HelpModal } from './components/help-modal';
import { helpContent } from './data/help-content';
document.addEventListener('DOMContentLoaded', () => {
    window.editor = new WorkflowEditor();
    HelpModal.init({ content: helpContent });
});
