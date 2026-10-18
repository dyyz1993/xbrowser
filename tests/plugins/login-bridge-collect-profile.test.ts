import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = new URL(
  "../../.xcli/plugins/login-bridge/collect-profile.sh",
  import.meta.url,
).pathname;

const chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium";

function launch(
  port: number,
  profile: string,
  source: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/sh",
      [script, String(port)],
      {
        timeout: 20_000,
        env: {
          ...process.env,
          XBROWSER_CHROMIUM_BIN: chromium,
          XBROWSER_COLLECT_PROFILE: profile,
          XBROWSER_COLLECT_SOURCE: source,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(new Error(`${error.message}\n${stdout}\n${stderr}`), {
              stdout,
              stderr,
            }),
          );
        } else resolve(stdout);
      },
    );
  });
}

async function alive(pid: number | undefined): Promise<boolean> {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopCollector(
  pid: number | undefined,
  profile: string,
): Promise<void> {
  if (!(await alive(pid))) return;
  const command = await new Promise<string>((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "command="], (_error, stdout) =>
      resolve(stdout),
    );
  });
  expect(command).toContain(`--user-data-dir=${profile}`);
  process.kill(pid as number, "SIGTERM");
  for (let i = 0; i < 30 && (await alive(pid)); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const ownedPids = new Set<number>();
const ownedProfiles = new Map<number, string>();

afterEach(async () => {
  for (const pid of [...ownedPids].reverse()) {
    await stopCollector(pid, ownedProfiles.get(pid) ?? "");
    ownedPids.delete(pid);
  }
});

describe("login-bridge collector launcher", () => {
  it("validates ownership, detached startup, and lock handling in source", () => {
    expect(existsSync(script)).toBe(true);
    const source = readFileSync(script, "utf8");
    expect(source).toContain("Default");
    expect(source).not.toContain(
      'cp "$HOME/Library/Application Support/Google/Chrome/Local State"',
    );
    expect(source).toContain('--remote-debugging-port="$PORT"');
    expect(source).toContain("chrome-collect-profile");
    expect(source).toContain(
      "XBROWSER_HUMANIZE_CDP=${XBROWSER_HUMANIZE_CDP:-on}",
    );
    expect(source).toContain("CANDIDATE=$!");
    expect(source).toContain('about:blank </dev/null >>"$LOG" 2>&1 &');
    expect(source).not.toContain("launchctl load");
    expect(source).not.toContain("<key>KeepAlive</key>");
    expect(source).toContain("is_our_collector");
    expect(source).toContain("--remote-debugging-port=${PORT}( |$)");
    expect(source).toContain("--user-data-dir=${PROFILE}( |$)");
    expect(source).toContain("endpoint_pid");
    expect(source).toContain("port $PORT is owned by another process");
    expect(source).toContain('readlink "$LOCKFILE"');
    expect(source).toContain("profile_pids");
    expect(source).toContain("</dev/null");
  });

  it.skipIf(!existsSync(chromium))(
    "starts a detached collector on an isolated port and profile",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "xbrowser-collector-"));
      const profile = join(home, "collector-profile");
      const source = join(home, "source-profile", "Default");
      mkdirSync(source, { recursive: true });
      mkdirSync(profile, { recursive: true });
      const port = 22000 + Math.floor(Math.random() * 1000);
      const output = await launch(port, profile, source);
      const pid = Number(output.match(/pid=(\d+)/)?.[1]);
      ownedPids.add(pid);
      ownedProfiles.set(pid, profile);
      expect(output).toContain(`collector ready on http://127.0.0.1:${port}`);
      expect(await alive(pid)).toBe(true);
      const command = await new Promise<string>((resolve) => {
        execFile(
          "ps",
          ["-p", String(pid), "-o", "command="],
          (_error, stdout) => resolve(stdout),
        );
      });
      expect(command).toContain(`--remote-debugging-port=${port}`);
      expect(command).toContain(`--user-data-dir=${profile}`);
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(
        (response) => response.json() as Promise<{ Browser?: string }>,
      );
      expect(version.Browser).toBeTruthy();
      expect(await alive(pid)).toBe(true);
    },
  );
  it.skipIf(!existsSync(chromium))(
    "rejects a foreign port owner before touching the profile",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "xbrowser-collector-"));
      const profile = join(home, "collector-profile");
      const source = join(home, "source-profile", "Default");
      mkdirSync(source, { recursive: true });
      mkdirSync(profile, { recursive: true });
      const foreign = spawn(
        "/usr/bin/python3",
        [
          "-c",
          "import http.server,socket; H=type('H',(http.server.BaseHTTPRequestHandler,),{'do_GET':lambda self: (self.send_response(200), self.end_headers(), self.wfile.write(b'{}')), 'log_message':lambda *a: None}); s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1]; s.close(); server=http.server.HTTPServer(('127.0.0.1',port),H); print(port, flush=True); server.serve_forever()",
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      const port = await new Promise<number>((resolve) => {
        foreign.stdout.once("data", (data) =>
          resolve(Number(String(data).trim())),
        );
      });
      await expect(launch(port, profile, source)).rejects.toThrow(
        /port \d+ is owned by another process/,
      );
      foreign.kill("SIGTERM");
    },
  );

  it.skipIf(!existsSync(chromium))(
    "rejects an active profile lock without repairing data",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "xbrowser-collector-"));
      const profile = join(home, "collector-profile");
      const source = join(home, "source-profile", "Default");
      mkdirSync(source, { recursive: true });
      mkdirSync(profile, { recursive: true });
      const sentinel = join(profile, "Default", "sentinel");
      mkdirSync(sentinel, { recursive: true });
      const port = 23000 + Math.floor(Math.random() * 1000);
      const first = await launch(port, profile, source);
      const firstPid = Number(first.match(/pid=(\d+)/)?.[1]);
      ownedPids.add(firstPid);
      ownedProfiles.set(firstPid, profile);
      const samePort = await launch(port, profile, source);
      expect(samePort).toContain("collector already running");
      await expect(launch(port + 1, profile, source)).rejects.toThrow(
        "profile is still active",
      );
      expect(existsSync(sentinel)).toBe(true);
    },
  );

  it.skipIf(!existsSync(chromium))(
    "is idempotent for the exact port and profile",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "xbrowser-collector-"));
      const profile = join(home, "collector-profile");
      const source = join(home, "source-profile", "Default");
      mkdirSync(source, { recursive: true });
      mkdirSync(profile, { recursive: true });
      const port = 24000 + Math.floor(Math.random() * 1000);
      const first = await launch(port, profile, source);
      const pid = Number(first.match(/pid=(\d+)/)?.[1]);
      ownedPids.add(pid);
      ownedProfiles.set(pid, profile);
      const second = await launch(port, profile, source);
      expect(second).toContain(
        `collector already running on http://127.0.0.1:${port}`,
      );
      expect(Number(second.match(/pid=(\d+)/)?.[1])).toBe(pid);
    },
  );
});
