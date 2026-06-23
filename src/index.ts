#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createPool } from "./db.js";
import {
  GET_MAJOR_BY_SCORE_TOOL,
  getMajorByScore,
  parseGetMajorByScoreArgs,
} from "./tools/getMajorByScore.js";
import {
  GET_MAJOR_BY_RANK_TOOL,
  getMajorByRank,
  parseGetMajorByRankArgs,
} from "./tools/getMajorByRank.js";
import {
  GET_RANK_BY_SCORE_TOOL,
  getRankByScore,
  parseGetRankByScoreArgs,
} from "./tools/getRankByScore.js";
import {
  GET_MAJOR_HISTORY_TOOL,
  getMajorHistory,
  parseGetMajorHistoryArgs,
} from "./tools/getMajorHistory.js";

const SERVER_NAME = "admission-score-mcp";
const SERVER_VERSION = "0.1.0";

function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  const fromArg = process.argv[2];
  const url = fromArg ?? fromEnv;
  if (!url) {
    console.error(
      "请提供数据库连接：命令行参数或环境变量 DATABASE_URL\n" +
        "示例: admission-score-mcp postgresql://user:pass@localhost:5432/admission",
    );
    process.exit(1);
  }
  return url;
}

const pool = createPool(resolveDatabaseUrl());

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    GET_MAJOR_BY_SCORE_TOOL,
    GET_MAJOR_BY_RANK_TOOL,
    GET_RANK_BY_SCORE_TOOL,
    GET_MAJOR_HISTORY_TOOL,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "getMajorByScore") {
    try {
      const parsed = parseGetMajorByScoreArgs(
        args as Record<string, unknown> | undefined,
      );
      const rows = await getMajorByScore(pool, parsed);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { count: rows.length, majors: rows },
              null,
              2,
            ),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  if (name === "getMajorByRank") {
    try {
      const parsed = parseGetMajorByRankArgs(
        args as Record<string, unknown> | undefined,
      );
      const result = await getMajorByRank(pool, parsed);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  if (name === "getMajorHistory") {
    try {
      const parsed = parseGetMajorHistoryArgs(
        args as Record<string, unknown> | undefined,
      );
      const rows = await getMajorHistory(pool, parsed);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: rows.length, rows }, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  if (name === "getRankByScore") {
    try {
      const parsed = parseGetRankByScoreArgs(
        args as Record<string, unknown> | undefined,
      );
      const rows = await getRankByScore(pool, parsed);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: rows.length, ranks: rows }, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function runServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
