"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const FALLBACK_ROOT = node_path_1.default.resolve(__dirname, '..', '..', '..');
const PROJECT_ROOT = process.env.PROJECT_ROOT || FALLBACK_ROOT;
const RUNS_DIR = node_path_1.default.resolve(PROJECT_ROOT, 'data', 'runs');
node_fs_1.default.mkdirSync(RUNS_DIR, { recursive: true });
exports.config = {
    port: Number(process.env.PORT ?? 3000),
    runsDir: RUNS_DIR,
    projectRoot: PROJECT_ROOT,
    openAiApiKey: process.env.OPENAI_API_KEY ?? ''
};
