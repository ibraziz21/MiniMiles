#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";

function usage() {
  console.error(
    "Usage: node scripts/with-available-port.mjs [--prefer <port>] [--env-only] -- <command> [args...]",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const envPort = process.env.PORT ? Number(process.env.PORT) : null;
let preferredPort = envPort ?? 3000;
let envOnly = false;
const commandIndex = args.indexOf("--");

if (commandIndex === -1) usage();

for (let i = 0; i < commandIndex; i += 1) {
  const arg = args[i];
  if (arg === "--prefer") {
    const next = args[i + 1];
    if (!next) usage();
    // On hosts like Railway/Render/Fly, PORT is the contract with the platform.
    // A local --prefer should not override it or the app will listen on the wrong port.
    if (envPort == null) preferredPort = Number(next);
    i += 1;
  } else if (arg === "--env-only") {
    envOnly = true;
  } else {
    usage();
  }
}

if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
  console.error(`Invalid preferred port: ${preferredPort}`);
  process.exit(1);
}

const command = args[commandIndex + 1];
const commandArgs = args.slice(commandIndex + 2);

if (!command) usage();

function canListen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (code === "EADDRINUSE" || code === "EACCES") {
          resolve(false);
          return;
        }
      }
      reject(error);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function findPort(start) {
  for (let port = start; port <= 65535; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available port found at or above ${start}`);
}

try {
  const port = await findPort(preferredPort);
  const childArgs = envOnly ? commandArgs : [...commandArgs, "--port", String(port)];

  console.log(`[ports] ${command} ${childArgs.join(" ")} using port ${port}`);

  const child = spawn(command, childArgs, {
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
