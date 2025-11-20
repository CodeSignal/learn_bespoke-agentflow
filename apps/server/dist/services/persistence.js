"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveRunLog = saveRunLog;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
async function saveRunLog(runsDir, result) {
    const filePath = node_path_1.default.join(runsDir, `run_${result.runId}.json`);
    await promises_1.default.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
}
