interface DownloadsApi {
  save(req: { filename: string; data: Blob }): Promise<{ status: string }>;
}
type ClaudeHost = { use?: (name: string) => Promise<unknown> };

/** Đang chạy trong trang Artifact của claude.ai (khung xem chặn tải file và hộp thoại in). */
export function isArtifactHost(): boolean {
  return typeof (globalThis as { claude?: ClaudeHost }).claude?.use === 'function';
}

/**
 * Tải file về máy. Trả về true khi đã giao file cho trình duyệt,
 * false khi người dùng từ chối lưu (trong Artifact).
 */
export async function downloadBytes(fileName: string, bytes: Uint8Array | string, mime: string): Promise<boolean> {
  const blob = new Blob([bytes], { type: mime });
  if (isArtifactHost()) {
    const downloads = (await (globalThis as { claude?: ClaudeHost }).claude!.use!('downloads')) as DownloadsApi | null;
    if (!downloads) throw new Error('Khung xem hiện tại không cho phép lưu file.');
    try {
      await downloads.save({ filename: fileName, data: blob });
      return true;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return false;
      throw new Error(`Không lưu được file (${code ?? (e as Error).message}).`);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function downloadJson(fileName: string, data: unknown): Promise<boolean> {
  return downloadBytes(fileName, JSON.stringify(data, null, 1), 'application/json');
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function readFileJson(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
