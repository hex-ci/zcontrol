/**
 * 复制文本到剪贴板。
 * 优先 Clipboard API（需要 HTTPS 或 localhost，且由用户手势触发）；
 * 失败时退回隐藏 textarea + execCommand，保证 HTTP 访问下也能复制。
 * 返回是否成功，提示文案由调用方决定。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 无权限或非安全上下文：走下面的兜底 */
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
