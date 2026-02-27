export const helpContent = `
<nav class="toc">
  <strong>Contents</strong>
  <ul>
    <li><a href="#overview">Overview</a></li>
    <li><a href="#build">Build a Workflow</a></li>
    <li><a href="#nodes">Node Guide</a></li>
    <li><a href="#run">Run and Review</a></li>
    <li><a href="#tips">Helpful Tips</a></li>
    <li><a href="#troubleshooting">Common Issues</a></li>
  </ul>
</nav>

<section id="overview">
  <h2>Overview</h2>
  <p>AgentFlow helps you design step-by-step AI workflows visually. Add nodes, connect them, run the flow, and review each response in the Run Console.</p>
</section>

<section id="build">
  <h2>Build a Workflow</h2>
  <ol>
    <li>Keep one <strong>Start</strong> node as your entry point.</li>
    <li>Add nodes from the left palette and connect them in order.</li>
    <li>Open each node to fill in prompts or rules.</li>
    <li>Enter your Initial Prompt and click <strong>Run Workflow</strong>.</li>
  </ol>
</section>

<section id="nodes">
  <h2>Node Guide</h2>
  <ul>
    <li><strong>Start</strong>: Begins the workflow with your initial input.</li>
    <li><strong>Agent</strong>: Generates a response based on your prompt and settings.</li>
    <li><strong>Condition</strong>: Sends the flow down different paths based on match rules.</li>
    <li><strong>Approval</strong>: Pauses the flow so you can choose Approve or Reject.</li>
  </ul>
</section>

<section id="run">
  <h2>Run and Review</h2>
  <p>While running, results appear in real time in the Run Console.</p>
  <ul>
    <li>Agent replies appear as they complete.</li>
    <li>If an Approval node is reached, the flow pauses until you decide.</li>
    <li>You can cancel a running flow at any time with the cancel button.</li>
  </ul>
</section>

<section id="tips">
  <h2>Helpful Tips</h2>
  <ul>
    <li>Start simple: <strong>Start → Agent</strong>, then add branching.</li>
    <li>Give each Agent a clear role in its system prompt.</li>
    <li>Use Condition nodes to control routing explicitly.</li>
    <li>If you refresh during a run, AgentFlow will try to recover it automatically.</li>
  </ul>
</section>

<section id="troubleshooting">
  <h2>Common Issues</h2>
  <details>
    <summary>Run button is disabled</summary>
    <p>Make sure your Start node is connected, links are valid, and branch nodes (Condition/Approval) have at least one outgoing path.</p>
  </details>
  <details>
    <summary>Flow pauses and does not continue</summary>
    <p>An Approval node is waiting for your decision. Click Approve or Reject in the Run Console.</p>
  </details>
  <details>
    <summary>Run did not recover after refresh</summary>
    <p>If recovery is not available, run the workflow again from the canvas.</p>
  </details>
</section>
`;
