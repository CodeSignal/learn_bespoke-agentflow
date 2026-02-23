export const helpContent = `
<nav class="toc">
  <strong>Contents</strong>
  <ul>
    <li><a href="#overview">Overview</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#features">Key Features</a></li>
    <li><a href="#workflow">Workflow</a></li>
    <li><a href="#faq">FAQ</a></li>
  </ul>
</nav>

<section id="overview">
  <h2>Overview</h2>
  <p>The Agentic Workflow Builder lets you compose agent flows with Start, Agent, If/Else, Approval, and End nodes. Drag nodes, connect them, configure prompts, and run against the server-side workflow engine.</p>
</section>

<section id="getting-started">
  <h2>Getting Started</h2>
  <ol>
    <li>Drag a <strong>Start</strong> node (auto-added) and at least one <strong>Agent</strong> node onto the canvas.</li>
    <li>Connect nodes by dragging from an output port to an input port.</li>
    <li>Open node settings (gear icon) to configure prompts, models, and approvals.</li>
    <li>Enter the initial user prompt in the Run Console and click <strong>Run Workflow</strong>.</li>
  </ol>
</section>

<section id="features">
  <h2>Key Features</h2>
  <h3>Visual Canvas</h3>
  <p>Pannable/zoomable canvas with SVG connections, floating palette, and snap-friendly controls.</p>
  <h3>Inline Node Editing</h3>
  <p>Expand a node to edit prompts, branching conditions, approval text, and tool toggles.</p>
  <h3>Run Console</h3>
  <p>Chat-style log with status indicator, agent spinner, and approval prompts when workflows pause for review.</p>
</section>

<section id="workflow">
  <h2>Workflow</h2>
  <ol>
    <li><strong>Design:</strong> Add nodes, wire edges, and double-check that the Start node connects to your flow.</li>
    <li><strong>Configure:</strong> Provide model settings, prompts, and optional tools per agent node.</li>
    <li><strong>Run:</strong> Click Run Workflow. The console streams logs from the server.</li>
    <li><strong>Approve:</strong> When approval nodes are reached, respond with Approve or Reject to continue.</li>
  </ol>
</section>

<section id="faq">
  <h2>FAQ</h2>
  <details>
    <summary>Why does a workflow pause?</summary>
    <p>Approval nodes intentionally pause execution until you make a decision in the Run Console.</p>
  </details>
</section>
`;
