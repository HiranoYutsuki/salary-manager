import { spawn } from "node:child_process";

console.log("APIキーなしで起動します。AI整理はアプリ画面からそのまま使えます。");

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const vite = spawn(command, ["vite", "--host", "127.0.0.1"], {
  stdio: "inherit",
});

vite.on("exit", (code) => {
  process.exit(code ?? 0);
});
