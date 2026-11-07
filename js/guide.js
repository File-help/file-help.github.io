/* 檔案整理小助手（機器人）：點擊才出現的圖解教學，會標示出畫面上對應的位置。 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  /* 每一步的小插圖（用表情符號組成的小動畫） */
  const ART = {
    hello: '<span class="a-wave">👋</span><span class="a-pop">✨</span>',
    privacy: '<span>💻</span><span class="a-lock">🔒</span><span class="a-no">☁️</span>',
    drop: '<span class="a-fall a1">📷</span><span class="a-fall a2">📄</span><span class="a-fall a3">🎵</span><span class="a-box">📥</span>',
    name: '<span class="a-chip">王小明</span><span class="a-arrow">➜</span><span class="a-folder">📁<small>王小明</small></span>',
    layers: '<span class="a-step s1">👤 名字</span><span class="a-arrow">›</span><span class="a-step s2">🖼️ 類型</span><span class="a-arrow">›</span><span class="a-step s3">📅 日期</span>',
    tree: '<span class="a-tree"><b>📁 王小明</b><i>📁 照片</i><i>📁 2025-08</i></span><span class="a-pencil">✏️</span>',
    zip: '<span class="a-box">📦</span><span class="a-down">⬇️</span><span class="a-pop">🎉</span>',
    pick: '<span class="a-card c1">🖼️</span><span class="a-card c2">📄</span><span class="a-card c3">📊</span>',
    settings: '<span class="a-slider"><i></i></span><span class="a-pop">⚙️</span>',
    convert: '<span>🖼️<small>HEIC</small></span><span class="a-spin">✨</span><span>🖼️<small>JPG</small></span>',
    pdf: '<span class="a-fall a1">📷</span><span class="a-fall a2">📷</span><span class="a-arrow">➜</span><span>📄<small>PDF</small></span>',
    done: '<span class="a-down">⬇️</span><span class="a-pop">🎉</span>',
  };

  const STEPS = {
    privacy: [
      { art: 'privacy', title: '隱私政策', text: '這頁說明我會讀取哪些資訊、不會做哪些事。重點只有一個：你的檔案不會上傳。' },
      { art: 'hello', title: '有問題嗎？', text: '想自己確認的話，看第 7 點，教你斷網使用或查看網路紀錄。' },
    ],
    home: [
      { art: 'hello', title: '嗨！我是檔案整理小助手', text: '這裡是入口。選一個工具，我就帶你過去！' },
      { art: 'layers', title: '自動整理', text: '一大堆照片、文件，依名字、類型、日期自動分好資料夾。', target: '#go-organize' },
      { art: 'convert', title: '轉檔', text: '圖片換格式、縮小、合併成 PDF，或是 Excel 和 CSV 互轉。', target: '#go-convert' },
      { art: 'drop', title: '趕時間的話', text: '直接把檔案拖到這個框框，我會自動打開「自動整理」。', target: '#home-drop' },
      { art: 'privacy', title: '放心，不會上傳', text: '所有處理都在你的裝置上完成，詳細說明在頁尾的「隱私政策」。想回到這裡，點左上角的標題就可以。' },
    ],
    organize: [
      { art: 'hello', title: '嗨！我是檔案整理小助手', text: '我來教你怎麼把一大堆檔案自動分好資料夾，只要 5 步就好！' },
      { art: 'privacy', title: '放心，不會上傳', text: '所有整理和轉檔都在你的電腦或手機裡完成，檔案不會離開你的裝置。' },
      { art: 'drop', title: '① 把檔案丟進來', text: '把照片、文件或整個資料夾拖到這個框框，或按「選擇檔案」。', target: '#org-drop' },
      { art: 'name', title: '② 輸入名字', text: '檔名裡有這個名字的檔案，會放進同一個資料夾。也可以點我找到的建議詞。', target: '#name-block', needs: '#org-main' },
      { art: 'layers', title: '③ 選分類方式', text: '依序是「名字 → 類型 → 日期」。不需要的那一層，取消勾選就好。', target: '#rules-card', needs: '#org-main' },
      { art: 'tree', title: '④ 看看預覽', text: '這裡會顯示整理後的資料夾。想換位置，可以在下面的清單直接修改。', target: '#preview-card', needs: '#org-main' },
      { art: 'zip', title: '⑤ 下載結果', text: '滿意就按「下載整理好的 ZIP」，大功告成！', target: '#btn-zip', needs: '#org-main' },
    ],
    convert: [
      { art: 'hello', title: '來轉檔吧！', text: '圖片換格式、縮小、合併成 PDF，或是 Excel 和 CSV 互轉，都可以喔。' },
      { art: 'pick', title: '① 選想做的事', text: '先點一個：圖片轉格式、圖片合併 PDF，或表格轉換。', target: '#ops-card' },
      { art: 'settings', title: '② 調整設定', text: '選要轉成什麼格式、畫質和大小。不確定的話，用預設值就很好了。', target: '#settings-card' },
      { art: 'pdf', title: '③ 加入檔案', text: '把檔案拖進來，或按「選擇檔案」。合併 PDF 時可以用 ↑ ↓ 調整頁序。', target: '#conv-drop' },
      { art: 'convert', title: '④ 開始轉換', text: '按「開始轉換」，完成後點檔名就能下載，多個檔案也能一次打包。', target: '#btn-convert' },
    ],
  };

  const bot = $('#guide-bot');
  const bubble = $('#guide-bubble');
  let steps = [], idx = 0, focused = null;

  const currentTab = () => document.body.dataset.view || 'home';
  const visible = el => !!el && el.offsetParent !== null;

  function clearFocus() {
    if (focused) focused.classList.remove('guide-focus');
    focused = null;
  }

  function show(i) {
    idx = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[idx];
    $('#guide-title').textContent = s.title;
    const art = $('#guide-art');
    art.innerHTML = ART[s.art] || '';
    art.classList.remove('play'); void art.offsetWidth; art.classList.add('play'); // 重新播放動畫

    clearFocus();
    let text = s.text;
    const target = s.target && document.querySelector(s.target);
    if (s.needs && !visible(document.querySelector(s.needs))) {
      text += '（先加入檔案，這一步才會出現喔！）';
    } else if (visible(target)) {
      focused = target;
      target.classList.add('guide-focus');
      const small = window.innerWidth < 600;
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: small ? 'start' : 'center' });
    }
    $('#guide-text').textContent = text;

    $('#guide-dots').innerHTML = steps.map((_, k) => `<button class="dot${k === idx ? ' on' : ''}" data-k="${k}" aria-label="第 ${k + 1} 步"></button>`).join('');
    $('#guide-prev').disabled = idx === 0;
    $('#guide-next').textContent = idx === steps.length - 1 ? '知道了！' : '下一步';
    bot.classList.remove('talk'); void bot.offsetWidth; bot.classList.add('talk');
  }

  function open() {
    steps = STEPS[currentTab()] || STEPS.home;
    bubble.hidden = false;
    bot.setAttribute('aria-expanded', 'true');
    document.body.classList.add('guide-open');
    show(0);
    $('#guide-next').focus({ preventScroll: true });
  }

  function close() {
    bubble.hidden = true;
    bot.setAttribute('aria-expanded', 'false');
    bot.classList.remove('talk');
    document.body.classList.remove('guide-open');
    clearFocus();
  }

  bot.addEventListener('click', () => (bubble.hidden ? open() : close()));
  $('#guide-close').addEventListener('click', close);
  $('#guide-prev').addEventListener('click', () => show(idx - 1));
  $('#guide-next').addEventListener('click', () => (idx === steps.length - 1 ? close() : show(idx + 1)));
  $('#guide-dots').addEventListener('click', e => { const d = e.target.closest('.dot'); if (d) show(+d.dataset.k); });
  document.addEventListener('keydown', e => {
    if (bubble.hidden) return;
    if (e.key === 'Escape') { close(); bot.focus(); }
    else if (e.key === 'ArrowRight' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) show(idx + 1);
    else if (e.key === 'ArrowLeft' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) show(idx - 1);
  });
  // 切換分頁時，說明內容跟著換
  document.addEventListener('viewchange', () => { if (!bubble.hidden) open(); });
  // 首頁放一隻大的小助手（複製右下角的圖）
  const hero = $('#hero-bot');
  if (hero) hero.appendChild(bot.querySelector('svg').cloneNode(true));
})();
