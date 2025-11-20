import type { Router } from 'express';
import { WorkflowLLM } from '@agentic/workflow-engine';
export declare function createWorkflowRouter(llm?: WorkflowLLM): Router;
