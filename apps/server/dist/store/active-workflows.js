"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addWorkflow = addWorkflow;
exports.getWorkflow = getWorkflow;
exports.removeWorkflow = removeWorkflow;
const workflows = new Map();
function addWorkflow(engine) {
    workflows.set(engine.getRunId(), engine);
}
function getWorkflow(runId) {
    return workflows.get(runId);
}
function removeWorkflow(runId) {
    workflows.delete(runId);
}
