export const helpContent = `
<nav class="toc">
  <strong>Contents</strong>
  <ul>
    <li><a href="#overview">Overview</a></li>
    <li><a href="#build">Build a Workflow</a></li>
    <li><a href="#nodes">Node Guide</a></li>
    <li><a href="#agents">Agent Options</a></li>
    <li><a href="#connections">Connections</a></li>
    <li><a href="#run">Run and Review</a></li>
    <li><a href="#keyboard">Keyboard and Undo</a></li>
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
    <li>Drag nodes from the left palette onto the canvas, or focus a palette item and press <kbd>Enter</kbd> to add it at the centre of the view.</li>
    <li>Connect the nodes in order by dragging from an output connector to an input connector.</li>
    <li>Open each node's settings to fill in prompts or rules.</li>
    <li>Enter your Initial Prompt and click <strong>Run Workflow</strong>.</li>
  </ol>
</section>

<section id="nodes">
  <h2>Node Guide</h2>
  <ul>
    <li><strong>Start</strong>: Begins the workflow with your Initial Prompt.</li>
    <li><strong>Agent</strong>: Generates a response based on its prompts, model and tools.</li>
    <li><strong>Condition</strong>: Sends the flow down the first branch whose rule matches the previous output (Equal or Contains, ignoring case), or down the fallback branch when none match.</li>
    <li><strong>User Approval</strong>: Pauses the flow so you can choose Approve or Reject.</li>
  </ul>
</section>

<section id="agents">
  <h2>Agent Options</h2>
  <ul>
    <li><strong>Input</strong>: The message sent to the agent. Write <code>{{PREVIOUS_OUTPUT}}</code> where the previous node's output should go. If you leave Input empty, the previous output is sent as it is.</li>
    <li><strong>Web Search</strong>: Lets the agent search the web while it answers.</li>
    <li><strong>Subagents</strong>: Lets the agent delegate work to other agents. Turn it on, then drag from the connector at the bottom of the agent to the green connector at the top of another agent.</li>
  </ul>
  <p>A subagent is a helper, not a workflow step: it has one parent, it cannot be part of the regular left-to-right flow, and its Input is written by its parent (your saved Input comes back if you remove the link). Subagent links cannot form a loop.</p>
</section>

<section id="connections">
  <h2>Connections</h2>
  <ul>
    <li><strong>Create</strong>: Drag from an output connector to another node's input connector.</li>
    <li><strong>Move</strong>: Drag an existing line to a different input connector.</li>
    <li><strong>Delete</strong>: Click a line to select it and press <kbd>Delete</kbd> or <kbd>Backspace</kbd>. Dragging a line and dropping it on empty canvas also removes it.</li>
    <li>A node with several outgoing lines runs those branches at the same time.</li>
    <li>Loops are allowed in the regular flow. A run that keeps looping is stopped with an error when it reaches the step limit.</li>
  </ul>
</section>

<section id="run">
  <h2>Run and Review</h2>
  <p>While running, results appear in real time in the Run Console.</p>
  <ul>
    <li>Agent replies appear as they complete.</li>
    <li>If a User Approval node is reached, the flow pauses until you decide.</li>
    <li>Use the cancel button next to Run to stop a flow while it is running or while it is paused waiting for approval.</li>
    <li>If you refresh during a run, AgentFlow reconnects to it. A run keeps going on the server until it finishes or you cancel it.</li>
  </ul>
</section>

<section id="keyboard">
  <h2>Keyboard and Undo</h2>
  <ul>
    <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd>: Undo. <kbd>Shift</kbd> + <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd> or <kbd>Ctrl</kbd> + <kbd>Y</kbd>: Redo. Undo covers adding, deleting and moving nodes, connections and settings changes. It is unavailable while a flow is running or paused.</li>
    <li><kbd>Tab</kbd>: Move between palette items, connections, nodes and their connectors.</li>
    <li>On a node: <kbd>Enter</kbd> opens or closes its settings, the arrow keys move it, and <kbd>Delete</kbd> removes it.</li>
    <li>On a connector: <kbd>Enter</kbd> on an output connector starts a connection; <kbd>Enter</kbd> on an input connector completes it.</li>
    <li><kbd>Esc</kbd>: Cancel a connection you are in the middle of making.</li>
    <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + scroll, or pinch: Zoom at the pointer.</li>
  </ul>
</section>

<section id="tips">
  <h2>Helpful Tips</h2>
  <ul>
    <li>Start simple: <strong>Start → Agent</strong>, then add branching.</li>
    <li>Give each Agent a clear role in its system prompt.</li>
    <li>Use Condition nodes to control routing explicitly.</li>
    <li>Your canvas is saved in this browser automatically.</li>
  </ul>
</section>

<section id="troubleshooting">
  <h2>Common Issues</h2>
  <details>
    <summary>Run button is disabled</summary>
    <p>Make sure your Start node is connected, links are valid, and branch nodes (Condition/User Approval) have at least one outgoing path. Hover the button to see the reason. While a flow is running or paused, cancel it first.</p>
  </details>
  <details>
    <summary>Flow pauses and does not continue</summary>
    <p>A User Approval node is waiting for your decision. Click Approve or Reject in the Run Console, or cancel the run.</p>
  </details>
  <details>
    <summary>Run stopped with a step limit error</summary>
    <p>The flow looped too many times. Check the Condition that is meant to end the loop.</p>
  </details>
  <details>
    <summary>Run did not recover after refresh</summary>
    <p>If recovery is not available, run the workflow again from the canvas.</p>
  </details>
</section>
`;
