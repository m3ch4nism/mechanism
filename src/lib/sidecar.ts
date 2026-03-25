import { Command, type Child } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";

let sidecarProcess: Child | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
let buffer = "";

export async function checkNodeInstalled(): Promise<boolean> {
  try {
    const cmd = Command.create("node", ["--version"]);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      cmd.on("close", (data) => { clearTimeout(t); resolve(data.code === 0); });
      cmd.on("error", () => { clearTimeout(t); resolve(false); });
      cmd.spawn();
    });
  } catch { return false; }
}

export async function installNode(): Promise<void> {
  // Download Node.js LTS installer and run it
  const url = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi";
  const downloadDir = await invoke<string>("get_exe_dir");
  const msiPath = downloadDir + "/node-installer.msi";

  // Download using PowerShell
  const dl = Command.create("powershell", [
    "-Command",
    `Invoke-WebRequest -Uri '${url}' -OutFile '${msiPath}'`
  ]);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Download timeout")), 120000);
    dl.on("close", (d) => { clearTimeout(t); d.code === 0 ? resolve() : reject(new Error("Download failed")); });
    dl.on("error", (e) => { clearTimeout(t); reject(new Error(e)); });
    dl.spawn();
  });

  // Run MSI installer
  const install = Command.create("powershell", [
    "-Command",
    `Start-Process msiexec -ArgumentList '/i','${msiPath}','/passive','/norestart' -Wait`
  ]);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Install timeout")), 300000);
    install.on("close", (d) => { clearTimeout(t); d.code === 0 ? resolve() : reject(new Error("Install failed")); });
    install.on("error", (e) => { clearTimeout(t); reject(new Error(e)); });
    install.spawn();
  });
}

export async function startSidecar() {
  if (sidecarProcess) return;

  let sidecarPath = "sidecar/index.js";
  try {
    const exeDir = await invoke<string>("get_exe_dir");
    sidecarPath = exeDir + "/sidecar/index.js";
  } catch {}

  const cmd = Command.create("node", [sidecarPath]);

  const stderrLines: string[] = [];
  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Sidecar timeout. Path: " + sidecarPath)), 10000);

    cmd.on("error", (err: string) => {
      clearTimeout(timeout);
      reject(new Error("Spawn error: " + err));
    });

    cmd.on("close", (data) => {
      clearTimeout(timeout);
      if (data.code !== null && data.code !== 0) {
        reject(new Error("Sidecar exit " + data.code + "\n" + stderrLines.join("\n")));
      }
    });

    cmd.stderr.on("data", (line: string) => {
      stderrLines.push(line.trim());
      if (line.includes("sidecar ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  cmd.stdout.on("data", (line: string) => {
    buffer += line;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const msg = JSON.parse(l);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      } catch {}
    }
  });

  sidecarProcess = await cmd.spawn();
  await readyPromise;
}

export function call(method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!sidecarProcess) {
      reject(new Error("Sidecar not started"));
      return;
    }
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    const msg = JSON.stringify({ id, method, params }) + "\n";
    sidecarProcess.write(msg);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 120000);
  });
}
