import { spawn } from "node:child_process";
import path from "node:path";

const viteCli = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");

const children = [
  spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: process.env.PORT || "8787" },
    stdio: "inherit"
  }),
  spawn(process.execPath, [viteCli, "--host", "0.0.0.0", "--port", "5173"], {
    stdio: "inherit"
  })
];

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

children.forEach((child) => {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exit(code);
    }
  });
});
