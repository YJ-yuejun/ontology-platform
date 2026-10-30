export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = body?.detail || body?.message || body || `请求失败 (${response.status})`;
    throw new Error(Array.isArray(message) ? message.map((item) => item.msg).join('；') : message);
  }
  return body;
}

export const saveJson = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

export const formatTime = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
};

export const ontologyExportFilename = (ontologyName) => {
  const baseName = String(ontologyName || '本体')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_') || '本体';
  const iso = new Date().toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}_${iso.slice(11, 19).replace(/:/g, '')}`;
  return `${baseName}_本体全量导出_${stamp}.xlsx`;
};
