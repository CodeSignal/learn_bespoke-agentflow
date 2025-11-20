"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const openai_1 = __importDefault(require("openai"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const workflows_1 = require("./routes/workflows");
const openai_llm_1 = require("./services/openai-llm");
const isProduction = process.env.NODE_ENV === 'production';
const webRoot = node_path_1.default.resolve(__dirname, '../../web');
const webDist = node_path_1.default.join(webRoot, 'dist');
async function bootstrap() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '1mb' }));
    let llmService;
    if (config_1.config.openAiApiKey) {
        logger_1.logger.info('OPENAI_API_KEY detected, enabling live OpenAI responses');
        const client = new openai_1.default({ apiKey: config_1.config.openAiApiKey });
        llmService = new openai_llm_1.OpenAILLMService(client);
    }
    else {
        logger_1.logger.warn('OPENAI_API_KEY missing. Falling back to mock LLM responses.');
    }
    app.use('/api', (0, workflows_1.createWorkflowRouter)(llmService));
    if (isProduction) {
        if (node_fs_1.default.existsSync(webDist)) {
            app.use(express_1.default.static(webDist));
            app.get('*', (_req, res) => {
                res.sendFile(node_path_1.default.join(webDist, 'index.html'));
            });
        }
        else {
            logger_1.logger.warn('Built web assets missing. Run `npm run build:web` before starting in production.');
        }
    }
    else {
        const { createServer: createViteServer } = await Promise.resolve().then(() => __importStar(require('vite')));
        const vite = await createViteServer({
            root: webRoot,
            configFile: node_path_1.default.join(webRoot, 'vite.config.ts'),
            server: { middlewareMode: true },
            appType: 'custom'
        });
        app.use(vite.middlewares);
        logger_1.logger.info('Vite dev middleware attached. UI available at http://localhost:%d', config_1.config.port);
    }
    app.listen(config_1.config.port, () => {
        logger_1.logger.info(`Server listening on http://localhost:${config_1.config.port}`);
    });
}
bootstrap().catch((error) => {
    logger_1.logger.error('Failed to start server', error);
    process.exitCode = 1;
});
