#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import winston from 'winston';
import dotenv from 'dotenv';

import { copybookParser } from './tools/copybook-parser.js';
import { cicsBridgeAssessment } from './tools/cics-bridge.js';
import { jclBatchScanner } from './tools/jcl-scanner.js';
import { vsamMapper } from './tools/vsam-mapper.js';
import { ebcdicTranslator } from './tools/ebcdic-translator.js';

dotenv.config();

// Logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Rate limiter
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'cobol-bridge',
  points: 100,
  duration: 60
});

// Validate API key
async function validateApiKey(apiKey: string): Promise<boolean> {
  const validKey = process.env.COBOL_BRIDGE_API_KEY;
  if (!validKey) return true;
  return apiKey === validKey;
}

// Create MCP server with all 5 tools
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'cobol-bridge',
    version: '1.0.0'
  });

  server.registerTool('copybook-parser', {
    description: copybookParser.description,
    inputSchema: copybookParser.schema
  }, async (args) => copybookParser.handler(args as any) as any);

  server.registerTool('cics-bridge-assessment', {
    description: cicsBridgeAssessment.description,
    inputSchema: cicsBridgeAssessment.schema
  }, async (args) => cicsBridgeAssessment.handler(args as any) as any);

  server.registerTool('jcl-batch-scanner', {
    description: jclBatchScanner.description,
    inputSchema: jclBatchScanner.schema
  }, async (args) => jclBatchScanner.handler(args as any) as any);

  server.registerTool('vsam-mapper', {
    description: vsamMapper.description,
    inputSchema: vsamMapper.schema
  }, async (args) => vsamMapper.handler(args as any) as any);

  server.registerTool('ebcdic-translator', {
    description: ebcdicTranslator.description,
    inputSchema: ebcdicTranslator.schema
  }, async (args) => ebcdicTranslator.handler(args as any) as any);

  return server;
}

// HTTP Server mode
async function startHttpServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://meok.ai', 'https://cobolbridge.ai'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id']
  }));
  app.use(express.json({ limit: '10mb' }));

  // Rate limiting
  app.use(async (req, res, next) => {
    try {
      await rateLimiter.consume(req.ip || 'unknown');
      next();
    } catch {
      res.status(429).json({ error: 'Too many requests' });
    }
  });

  // Health check — no auth required
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      tools: ['copybook-parser', 'cics-bridge-assessment', 'jcl-batch-scanner', 'vsam-mapper', 'ebcdic-translator']
    });
  });

  // MCP server + transport
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      logger.info({ event: 'mcp_session_init', sessionId });
    },
    onsessionclosed: (sessionId) => {
      logger.info({ event: 'mcp_session_close', sessionId });
    }
  });

  // /mcp — streamable HTTP (Smithery, Claude Desktop, OpenClaw, etc.)
  app.all('/mcp', async (req, res, next) => {
    // API key auth when COBOL_BRIDGE_API_KEY is set
    if (process.env.COBOL_BRIDGE_API_KEY) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (token !== process.env.COBOL_BRIDGE_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ event: 'mcp_error', error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // /mcp/sse — backward-compat redirect (SDK handles SSE via /mcp GET)
  app.get('/mcp/sse', (_req, res) => {
    res.redirect(301, '/mcp');
  });

  // DELETE /mcp — session termination
  app.delete('/mcp', async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.error({ event: 'mcp_close_error', error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await transport.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  app.listen(PORT, () => {
    logger.info({
      event: 'server_start',
      port: PORT,
      health: `http://localhost:${PORT}/health`,
      mcp: `http://localhost:${PORT}/mcp`,
      tools: ['copybook-parser', 'cics-bridge-assessment', 'jcl-batch-scanner', 'vsam-mapper', 'ebcdic-translator']
    });
  });
}

// Stdio mode (for local CLI / Claude Code)
async function startStdioServer() {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport();
  await server.connect(transport);
  logger.info('COBOL Bridge MCP server running on stdio');
}

// Main
async function main() {
  const mode = process.env.TRANSPORT_MODE || 'http';
  if (mode === 'http' || mode === 'sse') {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

main().catch((error) => {
  logger.error({ event: 'fatal', error: error.message });
  process.exit(1);
});
