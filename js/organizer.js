/* 自動分類邏輯：名字 → 類型 → 日期
 * 全部在瀏覽器內執行，只讀取檔名與照片的拍攝日期（不讀 GPS）。 */
(function () {
  'use strict';

  const TYPES = [
    { key: '照片', exts: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'svg', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf'] },
    { key: '影片', exts: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'flv', 'webm', '3gp', 'mts', 'm2ts'] },
    { key: '音訊', exts: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'aiff', 'amr', 'opus'] },
    { key: '文件', exts: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'pages', 'epub', 'hwp'] },
    { key: '試算表', exts: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers'] },
    { key: '簡報', exts: ['ppt', 'pptx', 'key', 'odp'] },
    { key: '壓縮檔', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'] },
  ];
  const EXT_TO_TYPE = {};
  TYPES.forEach(t => t.exts.forEach(e => { EXT_TO_TYPE[e] = t.key; }));
  const OTHER_TYPE = '其他';

  const IGNORED_FILES = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*)$/i;

  function splitName(fileName) {
    const i = fileName.lastIndexOf('.');
    if (i <= 0) return { stem: fileName, ext: '' };
    return { stem: fileName.slice(0, i), ext: fileName.slice(i + 1).toLowerCase() };
  }

  function typeOf(ext) {
    return EXT_TO_TYPE[ext] || OTHER_TYPE;
  }

  /* ---------- 日期 ---------- */

  function validDate(y, m, d) {
    const now = new Date().getFullYear() + 1;
    if (y < 1900 || y > now || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(y, m - 1, d);
  }

  /* 從照片 EXIF 讀取拍攝日期。只取 DateTimeOriginal / DateTime，不讀 GPS。
   * 支援 JPEG、HEIC、TIFF、多數 RAW（搜尋 Exif 標頭）。 */
  async function readExifDate(file) {
    const slice = await file.slice(0, 512 * 1024).arrayBuffer();
    const bytes = new Uint8Array(slice);
    const view = new DataView(slice);
    let tiff = -1;
    // 直接是 TIFF（TIFF / 部分 RAW）
    if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a)) {
      tiff = 0;
    } else {
      // 搜尋 "Exif\0\0"
      for (let i = 0; i < bytes.length - 10; i++) {
        if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x66 && bytes[i + 4] === 0 && bytes[i + 5] === 0) {
          const t = i + 6;
          if ((bytes[t] === 0x49 && bytes[t + 1] === 0x49) || (bytes[t] === 0x4d && bytes[t + 1] === 0x4d)) { tiff = t; break; }
        }
      }
    }
    if (tiff < 0) return null;
    try {
      const le = bytes[tiff] === 0x49;
      const u16 = o => view.getUint16(tiff + o, le);
      const u32 = o => view.getUint32(tiff + o, le);
      const readAscii = (entry) => {
        const count = u32(entry + 4);
        const off = count > 4 ? u32(entry + 8) : entry + 8;
        let s = '';
        for (let k = 0; k < count - 1 && tiff + off + k < bytes.length; k++) s += String.fromCharCode(bytes[tiff + off + k]);
        return s;
      };
      const scanIfd = (ifdOff, wanted) => {
        const found = {};
        if (tiff + ifdOff + 2 > bytes.length) return found;
        const n = u16(ifdOff);
        for (let k = 0; k < n; k++) {
          const e = ifdOff + 2 + k * 12;
          if (tiff + e + 12 > bytes.length) break;
          const tag = u16(e);
          if (wanted.includes(tag)) found[tag] = tag === 0x8769 ? u32(e + 8) : readAscii(e);
        }
        return found;
      };
      const ifd0 = scanIfd(u32(4), [0x0132, 0x8769]);
      let str = null;
      if (ifd0[0x8769]) {
        const exif = scanIfd(ifd0[0x8769], [0x9003, 0x9004]);
        str = exif[0x9003] || exif[0x9004];
      }
      str = str || ifd0[0x0132];
      const m = str && str.match(/^(\d{4}):(\d{2}):(\d{2})/);
      return m ? validDate(+m[1], +m[2], +m[3]) : null;
    } catch (e) {
      return null;
    }
  }

  function dateFromName(name) {
    const m = name.match(/(?:^|\D)((?:19|20)\d{2})[-_.年]?(0[1-9]|1[0-2])[-_.月]?(0[1-9]|[12]\d|3[01])(?!\d)/);
    return m ? validDate(+m[1], +m[2], +m[3]) : null;
  }

  async function detectDate(file, type) {
    if (type === '照片') {
      const d = await readExifDate(file).catch(() => null);
      if (d) return { date: d, source: '拍攝日期' };
    }
    const d = dateFromName(file.name);
    if (d) return { date: d, source: '檔名日期' };
    return { date: file.lastModified ? new Date(file.lastModified) : null, source: '修改日期' };
  }

  function formatDateParts(date, fmt) {
    if (!date) return ['日期不明'];
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    switch (fmt) {
      case 'Y': return [y];
      case 'Y/M': return [y, m + '月'];
      case 'YMD': return [`${y}-${m}-${d}`];
      default: return [`${y}-${m}`];
    }
  }

  /* ---------- 名字 ---------- */

  function parseNames(text) {
    const seen = new Set();
    return text.split(/[\n,，、;；]+/).map(s => s.trim()).filter(s => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* 找出檔名（或原資料夾）裡出現的名字；多個符合時取最長（最具體）的。 */
  function matchName(item, names, matchFolder) {
    const hay = (matchFolder ? item.relPath : item.file.name).toLowerCase();
    let best = null;
    for (const n of names) {
      if (hay.includes(n.toLowerCase()) && (!best || n.length > best.length)) best = n;
    }
    return best;
  }

  const STOP_WORDS = new Set(('img image images dsc dscn dscf dcim pxl mvimg vid video photo photos pic pics picture screenshot screen shot ' +
    'scan scanned copy final new untitled document doc file files edited edit export whatsapp line ig fb wechat download downloads ' +
    'jpg jpeg png heic pdf mov mp4 portrait burst cover live hdr pano sample test temp tmp backup ' +
    '截圖 螢幕擷取畫面 螢幕截圖 副本 複本 複製 新增 文件 照片 圖片 影片 掃描 未命名 最終版 修改 下載 資料夾 新資料夾 報告 檔案 備份').split(' '));

  function isCandidateToken(tok) {
    if (tok.length < 2 || tok.length > 20) return false;
    if (!/[A-Za-z㐀-鿿가-힯぀-ヿ]/.test(tok)) return false; // 至少要有字母或中日韓文字
    if (/\d{3,}/.test(tok)) return false;
    if (/^[a-z]{1,3}\d*$/i.test(tok) && tok.length <= 3) return false;
    return !STOP_WORDS.has(tok.toLowerCase());
  }

  /* 從檔名自動找可能是「名字」的字詞（出現在 2 個以上檔案）。只是建議，由使用者決定要不要加入。 */
  function suggestNames(items, existing) {
    const counts = new Map();
    const display = new Map();
    const bump = (tok, set) => {
      const k = tok.toLowerCase();
      if (set.has(k)) return;
      set.add(k);
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!display.has(k)) display.set(k, tok);
    };
    for (const it of items) {
      const set = new Set();
      const segments = it.relPath.split('/');
      const stem = splitName(segments.pop()).stem;
      const sources = [stem].concat(segments);
      for (const src of sources) {
        const tokens = src.split(/[\s_\-.()\[\]（）【】「」『』、，,+&#@!！~～]+/);
        for (const tok of tokens) {
          if (isCandidateToken(tok)) bump(tok, set);
          // 開頭的中文連續字（例如「王小明報告」→「王小明」「王小」…）
          const cjk = tok.match(/^[㐀-鿿]{2,}/);
          if (cjk) {
            for (let len = 2; len <= Math.min(4, cjk[0].length - 1); len++) {
              const p = cjk[0].slice(0, len);
              if (isCandidateToken(p)) bump(p, set);
            }
          }
        }
      }
    }
    const existingSet = new Set(existing.map(s => s.toLowerCase()));
    // 已輸入的名字，或被它包含／包含它的詞（例如已有「王小明」就不再建議「王小」）不再建議
    const overlaps = k => [...existingSet].some(e => e.includes(k) || k.includes(e));
    let cands = [...counts.entries()].filter(([k, c]) => c >= 2 && !overlaps(k));
    // 移除「被更長且次數相同的詞包含」的短詞（例：王小 vs 王小明）
    cands = cands.filter(([k, c]) => !cands.some(([k2, c2]) => k2 !== k && k2.length > k.length && k2.startsWith(k) && c2 === c));
    cands.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    return cands.slice(0, 30).map(([k, c]) => ({ name: display.get(k), count: c }));
  }

  /* ---------- 路徑 ---------- */

  function safeSegment(s) {
    let out = String(s).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 100);
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = '_' + out;
    return out || '_';
  }

  function normalizeDir(s) {
    return String(s).split(/[\\/]+/).map(x => x.trim()).filter(x => x && x !== '.' && x !== '..').map(safeSegment).join('/');
  }

  function targetDir(item, settings, names) {
    const parts = [];
    if (settings.useName) {
      const person = matchName(item, names, settings.matchFolder);
      item.person = person;
      if (person) parts.push(safeSegment(person));
    } else {
      item.person = null;
    }
    if (settings.useType) parts.push(item.type);
    if (settings.useDate) parts.push(...formatDateParts(item.date, settings.dateFmt));
    return parts.join('/');
  }

  function outputName(item, settings) {
    if (settings.heicToJpg && (item.ext === 'heic' || item.ext === 'heif')) {
      return splitName(item.file.name).stem + '.jpg';
    }
    return item.file.name;
  }

  /* 產生完整的輸出規劃（同資料夾同名時自動加上 (2)、(3)）。 */
  function plan(items, settings, names) {
    const used = new Set();
    return items.map(item => {
      const auto = targetDir(item, settings, names);
      const dir = item.override != null ? normalizeDir(item.override) : auto;
      let name = safeSegment(outputName(item, settings));
      const { stem, ext } = splitName(name);
      let n = 1;
      while (used.has(((dir ? dir + '/' : '') + name).toLowerCase())) {
        n++;
        name = `${stem} (${n})${ext ? '.' + ext : ''}`;
      }
      const path = (dir ? dir + '/' : '') + name;
      used.add(path.toLowerCase());
      return { item, dir, name, path, auto };
    });
  }

  async function makeItem(file, relPath, id) {
    const { ext } = splitName(file.name);
    const type = typeOf(ext);
    const { date, source } = await detectDate(file, type);
    return { id, file, relPath: relPath || file.name, ext, type, date, dateSource: source, person: null, override: null };
  }

  window.Organizer = { TYPES, OTHER_TYPE, IGNORED_FILES, splitName, typeOf, readExifDate, dateFromName, parseNames, suggestNames, plan, makeItem, normalizeDir, formatDateParts };
})();
