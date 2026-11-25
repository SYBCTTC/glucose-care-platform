/**
 * R28：触发浏览器打印（docs/specs/glucose-print.md §6）。
 *
 * 给 body 挂 `.gc-printing` → `window.print()` → 摘掉。
 * global.css 的 @media print 节在 .gc-printing 期间隐藏 #root 与 Modal 壳，
 * 只输出预览页（.gc-print-sheet）。
 *
 * 桌面浏览器（内网 Chrome/Edge）`window.print()` 会阻塞到打印对话框关闭，
 * finally 里同步摘类即可；即使个别浏览器提前返回，afterprint 兜底再摘一次。
 */
export function triggerBrowserPrint(): void {
  const cleanup = (): void => {
    document.body.classList.remove('gc-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  document.body.classList.add('gc-printing');
  try {
    window.print();
  } finally {
    cleanup();
  }
}
