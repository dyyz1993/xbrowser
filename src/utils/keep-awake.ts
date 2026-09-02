import { spawn } from 'child_process';

/**
 * sup-s12: 长任务防系统休眠——macOS 下 spawn `caffeinate -i -w <ppid>`
 * （空闲断言抑制；-w 父 pid 保证宿主进程退出时自动收尾），其他平台 no-op。
 * 回放/录制等分钟级无人值守任务在系统休眠下会被冻结中断。
 */
export function startKeepAwake(): { dispose: () => void; pid?: number } {
  if (process.platform !== 'darwin') return { dispose: () => { /* 非 macOS 无对应机制 */ } };
  try {
    const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      stdio: 'ignore',
      detached: false,
    });
    return {
      pid: child.pid,
      dispose: () => {
        try { child.kill('SIGTERM'); } catch { /* already exited */ }
      },
    };
  } catch {
    return { dispose: () => { /* caffeinate 不可用（非标准 macOS） */ } };
  }
}
