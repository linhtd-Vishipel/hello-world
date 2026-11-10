// Đóng gói ứng dụng thành một file HTML (CSS + JS nhúng) để đăng thành trang Artifact trên claude.ai.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build', { stdio: 'inherit', env: { ...process.env, ARTIFACT: '1' } });
const dir = 'dist-artifact/assets';
const files = readdirSync(dir);
const css = readFileSync(join(dir, files.find((f) => f.endsWith('.css'))), 'utf8');
const js = readFileSync(join(dir, files.find((f) => f.endsWith('.js'))), 'utf8').replace(/<\/script/gi, '<\\/script')
  // Ký tự U+FFFD trong thư viện → chuỗi thoát (giá trị không đổi trong chuỗi/regex JS)
  .replace(/\uFFFD/g, '\\uFFFD');
const html = `<title>Chấm công Đài TTDH</title>
<style>
:root { --page-bg: #f1f5f9; --page-fg: #0f172a; color-scheme: light; }
body { background: var(--page-bg); color: var(--page-fg); }
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync('dist-artifact/cham-cong.html', html);
console.log(`dist-artifact/cham-cong.html: ${(html.length / 1024).toFixed(0)} KB`);
