/* 介面邏輯 */
(function () {
  'use strict';
  if (!document.documentElement.lang) document.documentElement.lang = 'zh-Hant';

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
  const fmtDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '—';
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- 共用：進度、提示、下載 ---------- */
  function progress(text, ratio) {
    if (text == null) { $('#progress').hidden = true; return; }
    $('#progress').hidden = false;
    $('#progress-text').textContent = text;
    $('#progress-bar').style.width = Math.round((ratio || 0) * 100) + '%';
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }
  /* 在 claude.ai 上開啟時，用平台的「下載」功能（會先跳出確認）；在一般瀏覽器或本機開啟時，直接下載。 */
  const hosted = !!(window.claude && typeof window.claude.use === 'function');
  const dlCap = hosted ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  async function download(blob, name) {
    if (hosted) {
      const d = await dlCap;
      if (!d) { notify('這個畫面無法儲存檔案。請在瀏覽器開啟這個網站，或下載整個網站在電腦上使用。'); return false; }
      try {
        await d.save({ filename: name, data: blob });
        return true;
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') toast('已取消儲存');
        else if (code === 'rate_limited') toast('已經有一個儲存視窗開著，請先處理它');
        else if (code === 'too_large') notify('檔案太大，無法在這裡儲存。請分批處理。');
        else if (code === 'rejected_extension') notify('這種檔案格式無法在這裡儲存：' + name);
        else notify('無法儲存檔案（' + (code || '未知原因') + '）。請在瀏覽器開啟這個網站再試一次。');
        return false;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  /* 頁面內的對話框（取代 alert / confirm，嵌入其他網站時也能用） */
  function dialog(msg, withCancel, okText) {
    return new Promise(resolve => {
      const box = $('#dialog');
      $('#dialog-text').textContent = msg;
      $('#dialog-ok').textContent = okText || '好';
      $('#dialog-cancel').hidden = !withCancel;
      box.hidden = false;
      $('#dialog-ok').focus();
      const done = v => { box.hidden = true; $('#dialog-ok').onclick = $('#dialog-cancel').onclick = null; document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      $('#dialog-ok').onclick = () => done(true);
      $('#dialog-cancel').onclick = () => done(false);
    });
  }
  const ask = (msg, okText) => dialog(msg, true, okText);
  const notify = msg => dialog(msg, false);
  const stamp = () => { const d = new Date(); return fmtDate(d).replace(/-/g, '') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); };

  /* ---------- 共用：拖曳讀取（含資料夾） ---------- */
  async function readEntry(entry, path, out) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, relPath: path + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await readEntry(e, path + entry.name + '/', out);
      } while (batch.length);
    }
  }
  async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return [...dt.files].map(f => ({ file: f, relPath: f.name }));
    const out = [];
    for (const e of entries) await readEntry(e, '', out);
    return out;
  }
  function setupDrop(zone, onFiles) {
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove('over')));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      onFiles(await filesFromDrop(e.dataTransfer));
    });
  }
  // 避免拖到頁面其他地方時瀏覽器直接開啟檔案
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

  /* ---------- 入口與分頁（用網址 #home / #organize / #convert 切換，可用上一頁返回） ---------- */
  const VIEWS = ['home', 'organize', 'convert'];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    document.body.dataset.view = v;
    $('#view-home').hidden = v !== 'home';
    $('#tab-organize').hidden = v !== 'organize';
    $('#tab-convert').hidden = v !== 'convert';
    document.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.tab === v;
      t.classList.toggle('active', on);
      if (t.getAttribute('role') === 'tab') t.setAttribute('aria-selected', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    document.title = v === 'organize' ? '自動整理｜檔案整理轉檔' : v === 'convert' ? '轉檔｜檔案整理轉檔' : '檔案整理轉檔';
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('viewchange', { detail: v }));
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
   * 自動整理
   * ========================================================= */
  const org = { items: [], nextId: 1, keys: new Set(), planned: [] };
  const ROW_LIMIT = 300;
  let rowLimit = ROW_LIMIT;

  function settings() {
    return {
      useName: $('#use-name').checked,
      useType: $('#use-type').checked,
      useDate: $('#use-date').checked,
      dateFmt: $('#date-fmt').value,
      matchFolder: $('#match-folder').checked,
      heicToJpg: $('#heic-jpg').checked,
    };
  }
  const names = () => Organizer.parseNames($('#names').value);

  async function addOrgFiles(list) {
    list = list.filter(({ file }) => !Organizer.IGNORED_FILES.test(file.name));
    if (!list.length) return;
    let done = 0;
    for (const { file, relPath } of list) {
      const key = relPath + '|' + file.size + '|' + file.lastModified;
      if (!org.keys.has(key)) {
        org.keys.add(key);
        org.items.push(await Organizer.makeItem(file, relPath, org.nextId++));
      }
      done++;
      if (done % 20 === 0 || done === list.length) progress(`讀取檔案資訊… ${done} / ${list.length}`, done / list.length);
    }
    progress(null);
    $('#org-main').hidden = false;
    $('#btn-folder').hidden = hosted || !window.showDirectoryPicker;
    refreshSuggestions();
    render();
    toast(`已加入 ${list.length} 個檔案`);
  }

  function refreshSuggestions() {
    const list = Organizer.suggestNames(org.items, names());
    $('#suggest-wrap').hidden = !list.length;
    $('#suggest').innerHTML = list.map(s => `<button type="button" class="chip" data-name="${esc(s.name)}">${esc(s.name)} <small>${s.count}</small></button>`).join('');
  }
  $('#suggest').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const ta = $('#names');
    ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + chip.dataset.name;
    refreshSuggestions();
    render();
  });

  function render() {
    org.planned = Organizer.plan(org.items, settings(), names());
    renderSummary();
    renderTree();
    renderRows();
  }

  function renderSummary() {
    const p = org.planned;
    const people = new Set(p.filter(x => x.item.person).map(x => x.item.person));
    const dirs = new Set(p.map(x => x.dir));
    const total = p.reduce((s, x) => s + x.item.file.size, 0);
    const named = p.filter(x => x.item.person).length;
    $('#summary').innerHTML = [
      `<span class="stat"><b>${p.length}</b> 個檔案</span>`,
      `<span class="stat"><b>${dirs.size}</b> 個資料夾</span>`,
      `<span class="stat"><b>${fmtSize(total)}</b></span>`,
      settings().useName ? `<span class="stat"><b>${people.size}</b> 個名字・<b>${named}</b> 個檔案符合</span>` : '',
    ].join('');
  }

  function renderTree() {
    const root = { dirs: new Map(), files: [], count: 0 };
    for (const p of org.planned) {
      let node = root;
      node.count++;
      for (const seg of p.dir ? p.dir.split('/') : []) {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [], count: 0 });
        node = node.dirs.get(seg);
        node.count++;
      }
      node.files.push(p.name);
    }
    const draw = (node, depth) => {
      let html = '';
      const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
      for (const [name, child] of dirs) {
        html += `<details${depth < 1 ? ' open' : ''}><summary>📁 ${esc(name)} <span class="cnt">${child.count}</span></summary>${draw(child, depth + 1)}</details>`;
      }
      const shown = node.files.slice(0, 30);
      html += shown.map(f => `<div class="f">📄 ${esc(f)}</div>`).join('');
      if (node.files.length > shown.length) html += `<div class="f">…還有 ${node.files.length - shown.length} 個檔案</div>`;
      return html;
    };
    $('#tree').innerHTML = draw(root, 0) || '<p class="muted">沒有檔案</p>';
  }

  function renderRows() {
    const q = $('#filter').value.trim().toLowerCase();
    const list = q ? org.planned.filter(p => p.item.relPath.toLowerCase().includes(q)) : org.planned;
    const rows = list.slice(0, rowLimit).map(p => {
      const it = p.item;
      const person = it.person ? `<span class="tag person">${esc(it.person)}</span> ` : '';
      return `<tr>
        <td class="name" title="${esc(it.relPath)}">${esc(it.file.name)}</td>
        <td class="type"><span class="tag">${esc(it.type)}</span></td>
        <td class="date">${fmtDate(it.date)}<small>${esc(it.dateSource)}</small></td>
        <td class="target">${person}<input class="dir${it.override != null ? ' edited' : ''}" data-id="${it.id}" value="${esc(p.dir)}" aria-label="${esc(it.file.name)} 的資料夾" title="清空並按 Enter 可還原自動分類"></td>
      </tr>`;
    });
    $('#file-rows').innerHTML = rows.join('');
    const more = list.length - rowLimit;
    $('#more-rows').hidden = more <= 0;
    $('#more-rows').innerHTML = more > 0 ? `只顯示前 ${rowLimit} 筆，還有 ${more} 筆。<button class="btn tiny" id="show-all">全部顯示</button>` : '';
  }
  $('#more-rows').addEventListener('click', e => { if (e.target.id === 'show-all') { rowLimit = Infinity; renderRows(); } });
  $('#filter').addEventListener('input', debounce(renderRows, 200));

  $('#file-rows').addEventListener('change', e => {
    const input = e.target.closest('input.dir');
    if (!input) return;
    const item = org.items.find(i => i.id === +input.dataset.id);
    const v = input.value.trim();
    item.override = v === '' ? null : Organizer.normalizeDir(v);
    render();
  });

  const rerender = debounce(() => { refreshSuggestions(); render(); }, 250);
  $('#names').addEventListener('input', rerender);
  ['#use-name', '#use-type', '#use-date', '#date-fmt', '#match-folder', '#heic-jpg'].forEach(s => $(s).addEventListener('change', render));
  $('#use-name').addEventListener('change', () => { $('#name-block').hidden = !$('#use-name').checked; });

  $('#org-files').addEventListener('change', e => { addOrgFiles([...e.target.files].map(f => ({ file: f, relPath: f.name }))); e.target.value = ''; });
  $('#org-folder').addEventListener('change', e => { addOrgFiles([...e.target.files].map(f => ({ file: f, relPath: f.webkitRelativePath || f.name }))); e.target.value = ''; });
  if (!('webkitdirectory' in document.createElement('input')) || /iPhone|iPad|Android/i.test(navigator.userAgent)) $('#org-folder-label').hidden = true;
  setupDrop($('#org-drop'), addOrgFiles);
  // 首頁的拖曳區：直接打開自動整理
  setupDrop($('#home-drop'), list => { location.hash = '#organize'; addOrgFiles(list); });
  $('#home-files').addEventListener('change', e => { const list = [...e.target.files].map(f => ({ file: f, relPath: f.name })); e.target.value = ''; location.hash = '#organize'; addOrgFiles(list); });

  $('#btn-clear').addEventListener('click', async () => {
    if (!await ask('確定要清除清單上所有檔案嗎？（不會刪除你電腦裡的檔案）', '清除')) return;
    org.items = []; org.keys.clear(); org.planned = []; rowLimit = ROW_LIMIT;
    $('#org-main').hidden = true;
  });

  /* 取得要輸出的內容（必要時把 HEIC 轉成 JPG） */
  async function outputBlob(p) {
    const it = p.item;
    if (settings().heicToJpg && Converter.isHeic(it.file)) {
      try {
        return (await Converter.renderImage(it.file, { type: 'image/jpeg', quality: 0.92 })).blob;
      } catch (e) {
        console.warn('HEIC 轉檔失敗，保留原檔', it.file.name, e);
        p.failed = true;
        return it.file;
      }
    }
    return it.file;
  }
  // HEIC 轉檔失敗時改回原本的副檔名
  const finalPath = p => p.failed ? p.path.replace(/\.jpg$/i, '.' + p.item.ext) : p.path;

  $('#btn-zip').addEventListener('click', async () => {
    const plan = Organizer.plan(org.items, settings(), names());
    if (!plan.length) return;
    const total = plan.reduce((s, p) => s + p.item.file.size, 0);
    if (total > 1.8 * 1073741824 && !await ask(`檔案總共 ${fmtSize(total)}，ZIP 太大可能失敗。建議改用「直接存到電腦資料夾」，或分批處理。仍要繼續嗎？`, '繼續')) return;
    try {
      const zip = new JSZip();
      let i = 0;
      for (const p of plan) {
        const blob = await outputBlob(p);
        const already = /^(jpe?g|png|gif|webp|heic|heif|mp4|mov|m4v|zip|rar|7z|gz|mp3|m4a|avif|docx|xlsx|pptx)$/i.test(p.item.ext);
        zip.file(finalPath(p), blob, { date: p.item.date || new Date(p.item.file.lastModified), compression: already ? 'STORE' : 'DEFLATE' });
        i++;
        if (i % 10 === 0) progress(`準備檔案… ${i} / ${plan.length}`, i / plan.length);
      }
      const out = await zip.generateAsync({ type: 'blob', streamFiles: true }, m => progress(`壓縮中… ${Math.round(m.percent)}%`, m.percent / 100));
      progress(null);
      const failed = plan.filter(p => p.failed).length;
      if (await download(out, `整理好的檔案_${stamp()}.zip`)) toast(failed ? `完成！但有 ${failed} 個 HEIC 無法轉檔，已保留原檔` : '完成！ZIP 已儲存');
    } catch (e) {
      progress(null);
      notify('打包失敗：' + e.message + '。檔案可能太大，請分批處理。');
    }
  });

  $('#btn-folder').addEventListener('click', async () => {
    const plan = Organizer.plan(org.items, settings(), names());
    let root;
    try {
      root = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) { return; } // 使用者取消
    try {
      let i = 0;
      const dirCache = new Map();
      const getDir = async dir => {
        if (!dir) return root;
        if (dirCache.has(dir)) return dirCache.get(dir);
        let h = root;
        for (const seg of dir.split('/')) h = await h.getDirectoryHandle(seg, { create: true });
        dirCache.set(dir, h);
        return h;
      };
      for (const p of plan) {
        const dirH = await getDir(p.dir);
        const blob = await outputBlob(p);
        let name = finalPath(p).split('/').pop();
        // 資料夾裡已經有同名檔案就換個名字，不覆蓋
        const { stem, ext } = Organizer.splitName(name);
        for (let n = 2; ; n++) {
          try { await dirH.getFileHandle(name); name = `${stem} (${n})${ext ? '.' + ext : ''}`; } catch (e) { break; }
        }
        const fh = await dirH.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        i++;
        progress(`儲存中… ${i} / ${plan.length}`, i / plan.length);
      }
      progress(null);
      toast(`完成！已存入「${root.name}」資料夾`);
    } catch (e) {
      progress(null);
      notify('儲存失敗：' + e.message);
    }
  });

  /* =========================================================
   * 轉檔
   * ========================================================= */
  const conv = { files: [], results: [], nextId: 1 };
  const op = () => document.querySelector('input[name=op]:checked').value;
  const ACCEPT = {
    image: '.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.avif,image/*',
    pdf: '.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.avif,image/*',
    table: '.csv,.tsv,.xlsx,.xlsm,.json',
  };
  const supports = (f, o) => (o === 'table' ? Converter.TABLE_EXTS : Converter.IMAGE_EXTS).includes(Converter.extOf(f.name)) || (o !== 'table' && Converter.isHeic(f));

  function onOpChange() {
    const o = op();
    document.querySelectorAll('.opt').forEach(el => { el.hidden = el.dataset.op !== o; });
    $('#conv-files').accept = ACCEPT[o];
    conv.results = [];
    conv.files.forEach(f => { f.status = ''; f.results = null; });
    renderConv();
  }
  document.querySelectorAll('input[name=op]').forEach(r => r.addEventListener('change', onOpChange));
  $('#img-quality').addEventListener('input', e => { $('#img-quality-out').textContent = e.target.value; });

  function addConvFiles(list) {
    // 新加入的這批依檔名排序（PDF 頁序），已調整過的順序不變
    const batch = list.map(x => x.file).filter(f => !Organizer.IGNORED_FILES.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }));
    for (const file of batch) conv.files.push({ id: conv.nextId++, file, status: '' });
    renderConv();
  }

  function renderConv() {
    const o = op();
    $('#conv-list').innerHTML = conv.files.map((f, i) => {
      const ok = supports(f.file, o);
      const links = (f.results || []).map((r, j) => `<button class="dl" data-act="dl" data-i="${i}" data-j="${j}">⬇ ${esc(r.name)}</button>`).join(' ');
      const move = o === 'pdf' ? `<button class="btn tiny" data-act="up" data-i="${i}" aria-label="上移">↑</button><button class="btn tiny" data-act="down" data-i="${i}" aria-label="下移">↓</button>` : '';
      return `<li class="${ok ? '' : 'skip'}">${move}<span class="nm" title="${esc(f.file.name)}">${esc(f.file.name)}</span>
        <span class="st ${f.cls || ''}">${ok ? esc(f.status || fmtSize(f.file.size)) : '此功能不支援'}</span>${links}
        <button class="btn tiny ghost" data-act="del" data-i="${i}" aria-label="移除">✕</button></li>`;
    }).join('');
    $('#btn-convert').disabled = !conv.files.some(f => supports(f.file, o));
    $('#btn-conv-zip').hidden = conv.results.length < 2;
  }
  $('#conv-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.act === 'dl') { const r = conv.files[i].results[+b.dataset.j]; download(r.blob, r.name); return; }
    if (b.dataset.act === 'del') conv.files.splice(i, 1);
    if (b.dataset.act === 'up' && i > 0) [conv.files[i - 1], conv.files[i]] = [conv.files[i], conv.files[i - 1]];
    if (b.dataset.act === 'down' && i < conv.files.length - 1) [conv.files[i + 1], conv.files[i]] = [conv.files[i], conv.files[i + 1]];
    renderConv();
  });

  $('#conv-files').addEventListener('change', e => { addConvFiles([...e.target.files].map(f => ({ file: f }))); e.target.value = ''; });
  setupDrop($('#conv-drop'), addConvFiles);
  $('#btn-conv-clear').addEventListener('click', () => {
    conv.files = []; conv.results = [];
    renderConv();
  });

  function attach(f, results) {
    f.results = results;
    conv.results.push(...results);
  }

  $('#btn-convert').addEventListener('click', async () => {
    const o = op();
    const targets = conv.files.filter(f => supports(f.file, o));
    conv.files.forEach(f => { f.results = null; f.status = ''; f.cls = ''; });
    conv.results = [];
    try {
      if (o === 'pdf') {
        progress('合併 PDF…', 0);
        const blob = await Converter.imagesToPdf(targets.map(f => f.file), {
          pageSize: $('#pdf-size').value, margin: +$('#pdf-margin').value,
        }, r => progress(`合併 PDF… ${Math.round(r * targets.length)} / ${targets.length}`, r));
        const name = (($('#pdf-name').value.trim() || '合併文件').replace(/[\\/:*?"<>|]/g, '_')) + '.pdf';
        targets.forEach(f => { f.status = '已加入 PDF'; f.cls = 'ok'; });
        progress(null);
        download(blob, name);
        toast(`完成！${targets.length} 頁，${fmtSize(blob.size)}`);
        renderConv();
        return;
      }
      let i = 0;
      for (const f of targets) {
        progress(`轉換中… ${i + 1} / ${targets.length}：${f.file.name}`, i / targets.length);
        try {
          if (o === 'image') {
            const r = await Converter.convertImage(f.file, { type: $('#img-format').value, quality: +$('#img-quality').value / 100, maxSide: +$('#img-size').value });
            attach(f, [r]);
            const diff = Math.round((1 - r.blob.size / f.file.size) * 100);
            f.status = `${fmtSize(f.file.size)} → ${fmtSize(r.blob.size)}${diff > 0 ? `（省 ${diff}%）` : ''}${r.note ? '・' + r.note : ''}`;
          } else {
            const rs = await Converter.convertTable(f.file, $('#table-format').value);
            attach(f, rs);
            f.status = '完成';
          }
          f.cls = 'ok';
        } catch (e) {
          f.status = '失敗：' + (e.message || e);
          f.cls = 'err';
        }
        i++;
      }
      progress(null);
      renderConv();
      const ok = targets.filter(f => f.cls === 'ok').length;
      if (conv.results.length === 1) download(conv.results[0].blob, conv.results[0].name);
      toast(`完成 ${ok} / ${targets.length} 個檔案` + (conv.results.length > 1 ? '，可個別下載或全部打包' : ''));
    } catch (e) {
      progress(null);
      notify('轉換失敗：' + e.message);
    }
  });

  $('#btn-conv-zip').addEventListener('click', async () => {
    const zip = new JSZip();
    const used = new Set();
    for (const r of conv.results) {
      let name = r.name, n = 2;
      const { stem, ext } = Organizer.splitName(r.name);
      while (used.has(name.toLowerCase())) name = `${stem} (${n++}).${ext}`;
      used.add(name.toLowerCase());
      zip.file(name, r.blob);
    }
    const out = await zip.generateAsync({ type: 'blob' }, m => progress(`打包中… ${Math.round(m.percent)}%`, m.percent / 100));
    progress(null);
    download(out, `轉檔結果_${stamp()}.zip`);
  });

  onOpChange();
  route();
})();
