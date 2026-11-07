/* 轉檔：圖片格式／壓縮、HEIC→JPG、圖片合併 PDF、表格互轉。全部在瀏覽器內完成。 */
(function () {
  'use strict';

  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'];
  const TABLE_EXTS = ['csv', 'tsv', 'xlsx', 'xlsm', 'json'];
  const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  const extOf = name => (name.split('.').length > 1 ? name.split('.').pop() : '').toLowerCase();
  const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
  const isHeic = f => ['heic', 'heif'].includes(extOf(f.name)) || /image\/hei[cf]/.test(f.type);

  async function loadImage(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* 改用 <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /* HEIC 解碼器很大（1.3 MB），需要時才載入（仍是本機檔案，不連網） */
  let heicLoader = null;
  function loadHeic() {
    if (window.heic2any) return Promise.resolve();
    if (!heicLoader) {
      heicLoader = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/heic2any.min.js';
        s.onload = resolve;
        s.onerror = () => { heicLoader = null; reject(new Error('無法載入 HEIC 解碼器')); };
        document.head.appendChild(s);
      });
    }
    return heicLoader;
  }

  function withTimeout(promise, ms, msg) {
    let t;
    return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
  }

  async function decodeImage(file) {
    if (isHeic(file)) {
      // 先嘗試瀏覽器原生（Safari 支援），不行再用 heic2any
      try { return await loadImage(file); } catch (e) { /* fallthrough */ }
      await loadHeic();
      let out = await withTimeout(window.heic2any({ blob: file, toType: 'image/png' }), 120000, 'HEIC 轉檔逾時');
      if (Array.isArray(out)) out = out[0];
      return loadImage(out);
    }
    return loadImage(file);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('轉檔失敗'))), type, quality));
  }

  /* 重新繪製圖片：會自動轉正方向，並移除 EXIF（含 GPS 位置）等隱私資訊。 */
  async function renderImage(file, opts) {
    const { type = 'image/jpeg', quality = 0.9, maxSide = 0 } = opts || {};
    const img = await decodeImage(file);
    const w0 = img.width, h0 = img.height;
    let scale = 1;
    if (maxSide && Math.max(w0, h0) > maxSide) scale = maxSide / Math.max(w0, h0);
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); } // JPG 沒有透明，補白底
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    if (img.close) img.close();
    const blob = await canvasToBlob(canvas, type, quality);
    canvas.width = canvas.height = 0;
    return { blob, width: w, height: h };
  }

  async function convertImage(file, opts) {
    const { blob } = await renderImage(file, opts);
    // 舊版 Safari 不支援輸出 WebP，會改輸出 PNG
    const ext = MIME_EXT[blob.type] || 'png';
    return { blob, name: `${stemOf(file.name)}.${ext}`, note: blob.type !== opts.type ? '此瀏覽器不支援輸出所選格式，已改存 ' + ext.toUpperCase() : '' };
  }

  /* ---------- 圖片 → PDF ---------- */
  const A4 = [595.28, 841.89];

  async function imagesToPdf(files, opts, onProgress) {
    const { pageSize = 'a4', margin = 20, quality = 0.88, maxSide = 2480 } = opts || {};
    const enc = new TextEncoder();
    const chunks = [];
    let pos = 0;
    const offsets = [];
    const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };

    add(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4
    const pageRefs = [];
    const n = files.length;
    // 物件編號：1 Catalog、2 Pages，之後每頁 3 個物件（Page、Contents、Image）
    for (let i = 0; i < n; i++) {
      const { blob, width, height } = await renderImage(files[i], { type: 'image/jpeg', quality, maxSide });
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      let pw, ph, dw, dh, x, y;
      if (pageSize === 'fit') {
        dw = pw = width * 0.75; dh = ph = height * 0.75; x = y = 0;
        // 避免太小或超過 PDF 上限
        const s = Math.min(1, 14000 / Math.max(pw, ph));
        dw = pw = pw * s; dh = ph = ph * s;
      } else {
        [pw, ph] = width > height ? [A4[1], A4[0]] : A4;
        const s = Math.min((pw - 2 * margin) / width, (ph - 2 * margin) / height);
        dw = width * s; dh = height * s;
        x = (pw - dw) / 2; y = (ph - dh) / 2;
      }
      const pageN = 3 + i * 3, contN = pageN + 1, imgN = pageN + 2;
      const f = v => (Math.round(v * 100) / 100).toString();
      const content = `q ${f(dw)} 0 0 ${f(dh)} ${f(x)} ${f(y)} cm /Im0 Do Q`;

      offsets[pageN] = pos;
      add(`${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>\nendobj\n`);
      offsets[contN] = pos;
      add(`${contN} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      offsets[imgN] = pos;
      add(`${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      add(jpeg);
      add('\nendstream\nendobj\n');
      pageRefs.push(`${pageN} 0 R`);
      if (onProgress) onProgress((i + 1) / n);
    }
    offsets[1] = pos;
    add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offsets[2] = pos;
    add(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${n} >>\nendobj\n`);
    const total = 3 + n * 3;
    const xrefPos = pos;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let k = 1; k < total; k++) xref += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
    add(xref);
    add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  /* ---------- 表格 ---------- */
  async function convertTable(file, target) {
    const sheets = await TableTools.readAny(file);
    const stem = stemOf(file.name);
    if (target === 'xlsx') {
      return [{ blob: await TableTools.writeXLSX(sheets), name: `${stem}.xlsx` }];
    }
    if (target === 'json') {
      const data = sheets.length === 1 ? TableTools.rowsToObjects(sheets[0].rows)
        : Object.fromEntries(sheets.map(s => [s.name, TableTools.rowsToObjects(s.rows)]));
      return [{ blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name: `${stem}.json` }];
    }
    // CSV：加 BOM，Excel 開啟中文才不會亂碼；多個工作表就各存一個檔
    return sheets.map(s => ({
      blob: new Blob(['﻿' + TableTools.toCSV(s.rows)], { type: 'text/csv' }),
      name: sheets.length === 1 ? `${stem}.csv` : `${stem}_${s.name}.csv`,
    }));
  }

  window.Converter = { IMAGE_EXTS, TABLE_EXTS, extOf, stemOf, isHeic, renderImage, convertImage, imagesToPdf, convertTable };
})();
