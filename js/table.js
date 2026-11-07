/* 表格轉換：CSV / TSV / XLSX / JSON 互轉（不需上傳，不用外部服務）。
 * XLSX 讀寫使用 JSZip + 瀏覽器內建的 XML 解析。 */
(function () {
  'use strict';

  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

  /* ---------- 文字編碼（UTF-8 / Big5 自動判斷） ---------- */
  function decodeText(buf) {
    const bytes = new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      // 台灣舊版 Excel 存的 CSV 常是 Big5
      try { return new TextDecoder('big5').decode(bytes); } catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
  }

  /* ---------- CSV ---------- */
  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    let best = ',', bestCount = 0;
    for (const d of [',', '\t', ';', '|']) {
      let count = 0, inQ = false;
      for (const ch of firstLine) {
        if (ch === '"') inQ = !inQ;
        else if (ch === d && !inQ) count++;
      }
      if (count > bestCount) { best = d; bestCount = count; }
    }
    return best;
  }

  function parseCSV(text, delim) {
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
        if (ch === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toCSV(rows, delim) {
    delim = delim || ',';
    const esc = v => {
      const s = v == null ? '' : String(v);
      return (s.includes(delim) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(esc).join(delim)).join('\r\n');
  }

  /* ---------- 數值判斷（保留 0912… 這種前導 0 的電話、編號） ---------- */
  function looksNumeric(s) {
    return typeof s === 'string' && s.length < 16 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(s);
  }

  /* ---------- XLSX 寫入 ---------- */
  function xmlEsc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(i) {
    let s = ''; i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function sheetXml(rows) {
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="' + NS_MAIN + '"><sheetData>'];
    rows.forEach((row, r) => {
      out.push(`<row r="${r + 1}">`);
      row.forEach((v, c) => {
        if (v == null || v === '') return;
        const ref = colName(c) + (r + 1);
        if (typeof v === 'number' && isFinite(v)) out.push(`<c r="${ref}"><v>${v}</v></c>`);
        else if (typeof v === 'boolean') out.push(`<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`);
        else if (looksNumeric(v)) out.push(`<c r="${ref}"><v>${v}</v></c>`);
        else out.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(typeof v === 'object' ? JSON.stringify(v) : v)}</t></is></c>`);
      });
      out.push('</row>');
    });
    out.push('</sheetData></worksheet>');
    return out.join('');
  }

  function safeSheetNames(names) {
    const used = new Set();
    return names.map((n, i) => {
      let s = String(n || `工作表${i + 1}`).replace(/[\[\]:*?/\\]/g, '_').slice(0, 31) || `工作表${i + 1}`;
      let base = s, k = 2;
      while (used.has(s.toLowerCase())) s = (base.slice(0, 27) + ' (' + k++ + ')');
      used.add(s.toLowerCase());
      return s;
    });
  }

  /* sheets: [{name, rows}] → Blob */
  async function writeXLSX(sheets) {
    const zip = new JSZip();
    const names = safeSheetNames(sheets.map(s => s.name));
    const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
    const wbSheets = [], wbRels = [];
    sheets.forEach((s, i) => {
      const n = i + 1;
      zip.file(`xl/worksheets/sheet${n}.xml`, sheetXml(s.rows));
      ct.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      wbSheets.push(`<sheet name="${xmlEsc(names[i])}" sheetId="${n}" r:id="rId${n}"/>`);
      wbRels.push(`<Relationship Id="rId${n}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    });
    wbRels.push(`<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`);
    ct.push('</Types>');
    zip.file('[Content_Types].xml', ct.join(''));
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${wbSheets.join('')}</sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG_REL}">${wbRels.join('')}</Relationships>`);
    zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS_MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- XLSX 讀取 ---------- */
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function textOf(el) {
    // 合併 <t>，但略過注音／拼音 <rPh>
    let s = '';
    const ts = el.getElementsByTagNameNS('*', 't');
    for (const t of ts) {
      if (t.parentNode && t.parentNode.localName === 'rPh') continue;
      s += t.textContent;
    }
    return s;
  }

  async function readXLSX(buf) {
    const zip = await JSZip.loadAsync(buf);
    const parse = async p => {
      const f = zip.file(p);
      return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
    };
    const wb = await parse('xl/workbook.xml');
    if (!wb) throw new Error('不是有效的 XLSX 檔案');
    const rels = await parse('xl/_rels/workbook.xml.rels');
    const relMap = {};
    if (rels) for (const r of rels.getElementsByTagNameNS('*', 'Relationship')) {
      let t = r.getAttribute('Target');
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
      relMap[r.getAttribute('Id')] = t;
    }
    const sstDoc = await parse('xl/sharedStrings.xml');
    const sst = sstDoc ? [...sstDoc.getElementsByTagNameNS('*', 'si')].map(textOf) : [];
    const sheets = [];
    let idx = 0;
    for (const s of wb.getElementsByTagNameNS('*', 'sheet')) {
      idx++;
      const rid = s.getAttributeNS(NS_REL, 'id') || s.getAttribute('r:id');
      const doc = await parse(relMap[rid] || `xl/worksheets/sheet${idx}.xml`);
      if (!doc) continue;
      const rows = [];
      for (const rowEl of doc.getElementsByTagNameNS('*', 'row')) {
        const rNum = parseInt(rowEl.getAttribute('r'), 10);
        const rIndex = isNaN(rNum) ? rows.length : rNum - 1;
        const row = [];
        let auto = 0;
        for (const c of rowEl.getElementsByTagNameNS('*', 'c')) {
          let ci = colIndex(c.getAttribute('r'));
          if (ci < 0) ci = auto;
          auto = ci + 1;
          const t = c.getAttribute('t');
          const vEl = c.getElementsByTagNameNS('*', 'v')[0];
          const v = vEl ? vEl.textContent : '';
          let val;
          if (t === 's') val = sst[parseInt(v, 10)] ?? '';
          else if (t === 'inlineStr') val = textOf(c);
          else if (t === 'b') val = v === '1';
          else if (t === 'str' || t === 'e') val = v;
          else val = v === '' ? '' : (isNaN(Number(v)) ? v : Number(v));
          row[ci] = val;
        }
        for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
        rows[rIndex] = row;
      }
      for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
      sheets.push({ name: s.getAttribute('name') || `工作表${idx}`, rows });
    }
    return sheets;
  }

  /* ---------- JSON ---------- */
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const used = new Set();
    const width = Math.max(...rows.map(r => r.length));
    const header = Array.from({ length: width }, (_, i) => rows[0][i]).map((h, i) => {
      let k = (h == null || String(h).trim() === '') ? `欄位${i + 1}` : String(h).trim();
      let base = k, n = 2;
      while (used.has(k)) k = `${base}_${n++}`;
      used.add(k);
      return k;
    });
    return rows.slice(1).filter(r => r.some(v => v !== '' && v != null)).map(r => {
      const o = {};
      header.forEach((h, i) => {
        const v = r[i];
        o[h] = v == null ? '' : (looksNumeric(v) ? Number(v) : v);
      });
      return o;
    });
  }

  function valuesToRows(arr) {
    if (!Array.isArray(arr)) throw new Error('JSON 必須是陣列或「工作表名稱 → 陣列」的物件');
    if (arr.every(Array.isArray)) return arr.map(r => r.map(v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v));
    const keys = [];
    const seen = new Set();
    arr.forEach(o => {
      if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (!seen.has(k)) { seen.add(k); keys.push(k); } });
    });
    if (!keys.length) return [['值']].concat(arr.map(v => [v]));
    return [keys].concat(arr.map(o => keys.map(k => {
      const v = o && typeof o === 'object' ? o[k] : '';
      return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
    })));
  }

  function jsonToSheets(text) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return [{ name: '工作表1', rows: valuesToRows(data) }];
    if (data && typeof data === 'object') {
      const entries = Object.entries(data);
      if (entries.length && entries.every(([, v]) => Array.isArray(v))) return entries.map(([k, v]) => ({ name: k, rows: valuesToRows(v) }));
      return [{ name: '工作表1', rows: valuesToRows([data]) }];
    }
    throw new Error('JSON 內容無法轉成表格');
  }

  /* ---------- 對外：讀任何表格 → sheets ---------- */
  async function readAny(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const buf = await file.arrayBuffer();
    if (ext === 'xlsx' || ext === 'xlsm') return readXLSX(buf);
    const text = decodeText(buf);
    if (ext === 'json') return jsonToSheets(text);
    if (ext === 'tsv') return [{ name: '工作表1', rows: parseCSV(text, '\t') }];
    return [{ name: '工作表1', rows: parseCSV(text) }];
  }

  window.TableTools = { parseCSV, toCSV, readXLSX, writeXLSX, readAny, rowsToObjects, jsonToSheets, decodeText };
})();
