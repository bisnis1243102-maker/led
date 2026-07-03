/*
 * app.js — NeuroIDE application logic.
 *
 * Wires together:
 *   - a localStorage-backed virtual file system + explorer + tabs
 *   - a code editor (textarea + syntax-highlight overlay + line numbers)
 *   - a sandboxed JavaScript runner (iframe) with console capture
 *   - the from-scratch neural network (js/nn.js): live training,
 *     text generation and cursor autocompletion
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ storage ----
  // localStorage can be unavailable (sandboxed iframes, private mode);
  // fall back to in-memory storage so the app still works.
  const store = (() => {
    try {
      const k = '__neuroide_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      const mem = {};
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
      };
    }
  })();

  const FS_KEY = 'neuroide.fs.v1';
  const TABS_KEY = 'neuroide.tabs.v1';

  // ----------------------------------------------------------------- FS ----
  const FS = {
    files: {},
    load() {
      try {
        const raw = store.getItem(FS_KEY);
        this.files = raw ? JSON.parse(raw) : null;
      } catch (e) { this.files = null; }
      if (!this.files || Object.keys(this.files).length === 0) {
        this.files = Object.assign({}, self.NEURO_DEFAULT_FILES);
        this.save();
      }
    },
    save() { try { store.setItem(FS_KEY, JSON.stringify(this.files)); } catch (e) {} },
    read(name) { return this.files[name]; },
    write(name, content) { this.files[name] = content; this.save(); },
    remove(name) { delete this.files[name]; this.save(); },
    exists(name) { return Object.prototype.hasOwnProperty.call(this.files, name); },
    names() { return Object.keys(this.files).sort(); },
  };

  // ------------------------------------------------------------- editor ----
  const ed = $('ed');            // textarea
  const hl = $('hl');            // <code> inside <pre>
  const hlPre = $('hl-pre');
  const gutter = $('gutter');

  let openTabs = [];
  let activeFile = null;

  function langOf(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ({ js: 'js', mjs: 'js', json: 'json', lua: 'lua', md: 'md', markdown: 'md',
      html: 'html', htm: 'html', css: 'css', txt: 'text' })[ext] || 'text';
  }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  const HL_RULES = {
    js: {
      re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\[\s\S])*`?)|(\b\d[\w.]*\b)|(\b(?:const|let|var|function|return|if|else|for|while|do|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|switch|case|default|try|catch|finally|throw|delete|void|yield|async|await|import|export|from|static|get|set)\b)|(\b(?:true|false|null|undefined|NaN|Infinity)\b)|([A-Za-z_$][\w$]*(?=\s*\())/g,
      cls: ['cmt', 'str', 'num', 'kw', 'lit', 'fn'],
    },
    lua: {
      re: /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|\[\[[\s\S]*?\]\])|(\b\d[\w.]*\b)|(\b(?:local|function|end|if|then|elseif|else|for|while|repeat|until|return|break|do|in|and|or|not|goto)\b)|(\b(?:nil|true|false|self)\b)|([A-Za-z_]\w*(?=\s*\())/g,
      cls: ['cmt', 'str', 'num', 'kw', 'lit', 'fn'],
    },
    json: {
      re: /("(?:[^"\\\n]|\\.)*")(?=\s*:)|("(?:[^"\\\n]|\\.)*")|(-?\b\d[\w.+-]*\b)|(\b(?:true|false|null)\b)/g,
      cls: ['key', 'str', 'num', 'lit'],
    },
    md: {
      re: /(^#{1,6}[^\n]*$)|(```[\s\S]*?```|`[^`\n]*`)|(\*\*[^*\n]+\*\*)|(^\s*(?:[-*+]|\d+\.)\s)|(\[[^\]\n]*\]\([^)\n]*\))/gm,
      cls: ['head', 'str', 'kw', 'lit', 'fn'],
    },
  };

  function highlight(code, lang) {
    const html = esc(code);
    const rule = HL_RULES[lang];
    if (!rule) return html;
    return html.replace(rule.re, (...args) => {
      const m = args[0];
      for (let g = 1; g <= rule.cls.length; g++) {
        if (args[g] !== undefined) return '<span class="tk-' + rule.cls[g - 1] + '">' + m + '</span>';
      }
      return m;
    });
  }

  function refreshEditor() {
    const code = ed.value;
    hl.innerHTML = highlight(code, langOf(activeFile || '')) + '\n';
    const lines = code.split('\n').length;
    let g = '';
    for (let i = 1; i <= lines; i++) g += i + '\n';
    gutter.textContent = g;
    syncScroll();
  }

  function syncScroll() {
    hlPre.scrollTop = ed.scrollTop;
    hlPre.scrollLeft = ed.scrollLeft;
    gutter.style.transform = 'translateY(' + (-ed.scrollTop) + 'px)';
  }
  ed.addEventListener('scroll', syncScroll);

  let saveTimer = null;
  ed.addEventListener('input', () => {
    if (activeFile !== null) {
      clearTimeout(saveTimer);
      const name = activeFile, val = ed.value;
      saveTimer = setTimeout(() => { FS.write(name, val); }, 250);
    }
    refreshEditor();
  });

  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runActiveFile();
    } else if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      AI.completeAtCursor();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (activeFile !== null) { FS.write(activeFile, ed.value); flashStatus('saved ' + activeFile); }
    }
  });

  function insertAtCursor(text) {
    ed.focus();
    // execCommand keeps the browser's undo stack; fall back if unsupported.
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (err) { ok = false; }
    if (!ok) {
      const s = ed.selectionStart, epos = ed.selectionEnd;
      ed.setRangeText(text, s, epos, 'end');
      ed.dispatchEvent(new Event('input'));
    }
  }

  ['keyup', 'click', 'input'].forEach((ev) => ed.addEventListener(ev, updateCursorStatus));
  function updateCursorStatus() {
    const upto = ed.value.slice(0, ed.selectionStart);
    const line = upto.split('\n').length;
    const col = upto.length - upto.lastIndexOf('\n');
    $('st-pos').textContent = 'Ln ' + line + ', Col ' + col;
  }

  // --------------------------------------------------------- tabs & files ----
  function loadTabs() {
    try {
      const t = JSON.parse(store.getItem(TABS_KEY) || 'null');
      if (t && Array.isArray(t.open)) { openTabs = t.open.filter((n) => FS.exists(n)); activeFile = t.active; }
    } catch (e) {}
    if (!openTabs.length) openTabs = FS.exists('welcome.md') ? ['welcome.md'] : FS.names().slice(0, 1);
    if (!activeFile || !openTabs.includes(activeFile)) activeFile = openTabs[0] || null;
  }
  function saveTabs() { try { store.setItem(TABS_KEY, JSON.stringify({ open: openTabs, active: activeFile })); } catch (e) {} }

  function openFile(name) {
    if (!FS.exists(name)) return;
    if (!openTabs.includes(name)) openTabs.push(name);
    activeFile = name;
    ed.value = FS.read(name);
    ed.scrollTop = 0;
    renderTabs();
    renderFileList();
    refreshEditor();
    updateCursorStatus();
    $('st-lang').textContent = langOf(name);
    saveTabs();
  }

  function closeTab(name) {
    const i = openTabs.indexOf(name);
    if (i >= 0) openTabs.splice(i, 1);
    if (activeFile === name) {
      activeFile = openTabs[Math.max(0, i - 1)] || null;
      if (activeFile) { ed.value = FS.read(activeFile); } else { ed.value = ''; }
      refreshEditor();
    }
    renderTabs();
    renderFileList();
    saveTabs();
  }

  function renderTabs() {
    const bar = $('tabs');
    bar.innerHTML = '';
    for (const name of openTabs) {
      const t = document.createElement('div');
      t.className = 'tab' + (name === activeFile ? ' active' : '');
      const label = document.createElement('span');
      label.textContent = name;
      t.appendChild(label);
      const x = document.createElement('span');
      x.className = 'tab-close';
      x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(name); });
      t.appendChild(x);
      t.addEventListener('click', () => openFile(name));
      bar.appendChild(t);
    }
  }

  const EXT_BADGE = { js: 'JS', lua: 'LU', md: 'MD', json: '{}', html: '<>', css: '#', text: 'TX' };

  function renderFileList() {
    const list = $('file-list');
    list.innerHTML = '';
    for (const name of FS.names()) {
      const row = document.createElement('div');
      row.className = 'file' + (name === activeFile ? ' active' : '');
      const badge = document.createElement('span');
      const lang = langOf(name);
      badge.className = 'badge badge-' + lang;
      badge.textContent = EXT_BADGE[lang] || 'TX';
      row.appendChild(badge);
      const label = document.createElement('span');
      label.className = 'fname';
      label.textContent = name;
      row.appendChild(label);
      const del = document.createElement('span');
      del.className = 'file-act';
      del.title = 'delete';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete ' + name + '?')) return;
        FS.remove(name);
        closeTab(name);
        renderFileList();
        logSys('deleted ' + name);
      });
      row.appendChild(del);
      row.addEventListener('click', () => openFile(name));
      row.addEventListener('dblclick', () => {
        const nn2 = prompt('Rename file', name);
        if (!nn2 || nn2 === name || FS.exists(nn2)) return;
        FS.write(nn2, FS.read(name));
        FS.remove(name);
        const i = openTabs.indexOf(name);
        if (i >= 0) openTabs[i] = nn2;
        if (activeFile === name) activeFile = nn2;
        renderTabs(); renderFileList(); saveTabs();
      });
      list.appendChild(row);
    }
  }

  // Inline "new file" input (prompt() is blocked in sandboxed iframes).
  $('btn-new-file').addEventListener('click', () => {
    const list = $('file-list');
    if (list.querySelector('.file-new')) return;
    const row = document.createElement('div');
    row.className = 'file file-new';
    const input = document.createElement('input');
    input.className = 'file-new-input';
    input.placeholder = 'filename.js';
    row.appendChild(input);
    list.insertBefore(row, list.firstChild);
    input.focus();
    let closed = false;
    const done = (create) => {
      if (closed) return;
      closed = true;
      const name = input.value.trim();
      row.remove();
      if (!create || !name) return;
      if (FS.exists(name)) { logSys('file already exists: ' + name); return; }
      FS.write(name, '');
      renderFileList();
      openFile(name);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(input.value.trim().length > 0));
  });

  function resetWorkspace() {
    store.removeItem(FS_KEY);
    store.removeItem(TABS_KEY);
    location.reload();
  }

  $('btn-reset-ws').addEventListener('click', () => {
    if (!confirm('Reset workspace? This restores the default files and deletes your changes.')) return;
    resetWorkspace();
  });

  // ------------------------------------------------------------- console ----
  const consoleOut = $('console-out');
  function logEntry(type, text) {
    const div = document.createElement('div');
    div.className = 'entry entry-' + type;
    div.textContent = text;
    consoleOut.appendChild(div);
    while (consoleOut.children.length > 500) consoleOut.removeChild(consoleOut.firstChild);
    consoleOut.scrollTop = consoleOut.scrollHeight;
  }
  const logSys = (t) => logEntry('sys', t);
  $('btn-clear-console').addEventListener('click', () => { consoleOut.innerHTML = ''; });

  function flashStatus(text) {
    const el = $('st-flash');
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1200);
  }

  // -------------------------------------------------------------- runner ----
  let runFrame = null;
  let runSink = null;      // optional callback receiving {type, text} entries
  let runTimer = null;

  function endRun(note) {
    if (runTimer) { clearTimeout(runTimer); runTimer = null; }
    if (runFrame) { runFrame.remove(); runFrame = null; }
    const sink = runSink;
    runSink = null;
    if (note && sink) sink({ type: 'sys', text: note });
    if (sink) sink({ type: 'done', text: '' });
  }

  function runJS(source, label, sink) {
    if (runFrame) endRun('(previous run cancelled)');
    runSink = sink || null;
    logSys('▶ running ' + label + ' …');
    const code = source.replace(/<\/script/gi, '<\\/script');
    const boot = [
      '<script>',
      'const fmt = (v) => { if (typeof v === "string") return v;',
      '  try { return JSON.stringify(v, null, 0); } catch (e) { return String(v); } };',
      'const send = (type, args) => parent.postMessage({ neuroRun: true, type,',
      '  text: args.map(fmt).join(" ") }, "*");',
      '["log","info","warn","error"].forEach((k) => {',
      '  const orig = console[k].bind(console);',
      '  console[k] = (...a) => { send(k === "info" ? "log" : k, a); orig(...a); };',
      '});',
      'window.onerror = (m, s, l, c) => { send("error", [m + " (line " + l + ")"]); };',
      'try {',
      code,
      '} catch (e) { send("error", [String((e && e.stack) || e)]); }',
      'send("done", []);',
      '<\/script>',
    ].join('\n');
    runFrame = document.createElement('iframe');
    runFrame.setAttribute('sandbox', 'allow-scripts');
    runFrame.style.display = 'none';
    runFrame.srcdoc = boot;
    document.body.appendChild(runFrame);
    runTimer = setTimeout(() => { logSys('⏱ run timed out (10s)'); endRun('(timed out after 10s)'); }, 10000);
  }

  function runActiveFile() {
    if (!activeFile) return;
    if (langOf(activeFile) !== 'js') { logSys('only .js files can be run (active: ' + activeFile + ')'); return; }
    FS.write(activeFile, ed.value);
    runJS(ed.value, activeFile);
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || !d.neuroRun) return;
    if (d.type === 'done') { logSys('✓ finished'); endRun(); return; }
    logEntry(d.type, d.text);
    if (runSink) runSink({ type: d.type, text: d.text });
  });

  $('btn-run').addEventListener('click', runActiveFile);

  // ------------------------------------------------------------------ AI ----
  const PRESETS = {
    nano:   { blockSize: 24, nEmbd: 32, nLayer: 2, nHead: 2, batchSize: 8, lr: 3e-3 },
    small:  { blockSize: 32, nEmbd: 48, nLayer: 2, nHead: 2, batchSize: 8, lr: 2e-3 },
    medium: { blockSize: 48, nEmbd: 64, nLayer: 3, nHead: 4, batchSize: 8, lr: 1.5e-3 },
  };

  const AI = {
    model: null,
    tok: null,
    trainer: null,
    training: false,
    generating: false,
    steps: 0,
    ema: null,
    lossHist: [],
    histStride: 1,
    _sinceHist: 0,
    stepMs: 0,

    corpusText() {
      const mode = $('ai-corpus').value;
      let text = '';
      if (mode === 'train-file') text = FS.read('train-data.txt') || '';
      else if (mode === 'active') text = activeFile ? (FS.read(activeFile) || '') : '';
      else { // all files
        text = FS.names().map((n) => FS.read(n)).join('\n\n');
      }
      if (!text) text = 'the quick brown fox jumps over the lazy dog. ';
      while (text.length < 512) text += '\n' + text; // tiny corpora: tile up
      return text;
    },

    init() {
      const preset = PRESETS[$('ai-preset').value];
      const corpus = this.corpusText();
      this.tok = new NN.CharTokenizer(corpus);
      NN.seed((Math.random() * 1e9) | 0);
      this.model = new NN.CharLM({
        vocabSize: this.tok.vocabSize,
        blockSize: preset.blockSize,
        nEmbd: preset.nEmbd,
        nLayer: preset.nLayer,
        nHead: preset.nHead,
      });
      this.trainer = new NN.Trainer(this.model, this.tok.encode(corpus), {
        batchSize: preset.batchSize, lr: preset.lr,
      });
      this.steps = 0;
      this.ema = null;
      this.lossHist = [];
      this.histStride = 1;
      this._sinceHist = 0;
      logSys('model initialized: ' + this.model.paramCount().toLocaleString() +
        ' params, vocab ' + this.tok.vocabSize + ', corpus ' + corpus.length.toLocaleString() + ' chars');
      this.refreshInfo();
    },

    reset() {
      this.stopTraining();
      this.model = null; this.tok = null; this.trainer = null;
      this.steps = 0; this.ema = null; this.lossHist = []; this.histStride = 1; this._sinceHist = 0;
      this.refreshInfo();
      drawChart();
      logSys('model reset');
    },

    ensureModel() {
      if (!this.model) this.init();
      if (!this.trainer) {
        const preset = PRESETS[$('ai-preset').value];
        this.trainer = new NN.Trainer(this.model, this.tok.encode(this.corpusText()), {
          batchSize: preset.batchSize, lr: preset.lr,
        });
        this.trainer.steps = this.steps;
      }
    },

    startTraining() {
      this.ensureModel();
      this.training = true;
      $('btn-train').textContent = '⏸ Pause';
      $('btn-train').classList.add('active');
      $('chip-model').textContent = 'training…';
      $('chip-model').classList.add('on');
      this._tick();
    },

    stopTraining() {
      this.training = false;
      $('btn-train').textContent = '▶ Start training';
      $('btn-train').classList.remove('active');
      $('chip-model').textContent = this.model ? 'model: ' + this.steps + ' steps' : 'model: untrained';
      $('chip-model').classList.remove('on');
    },

    _tick() {
      if (!AI.training) return;
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < 85 && n < 24) {
        const loss = AI.trainer.step();
        AI.steps = AI.trainer.steps;
        AI.ema = AI.ema === null ? loss : AI.ema * 0.95 + loss * 0.05;
        AI._sinceHist++;
        if (AI._sinceHist >= AI.histStride) {
          AI._sinceHist = 0;
          AI.lossHist.push(AI.ema);
          if (AI.lossHist.length > 900) {
            AI.lossHist = AI.lossHist.filter((_, i) => i % 2 === 0);
            AI.histStride *= 2;
          }
        }
        n++;
      }
      AI.stepMs = (performance.now() - t0) / Math.max(n, 1);
      AI.refreshStats();
      drawChart();
      setTimeout(() => AI._tick(), 12);
    },

    refreshStats() {
      $('ai-steps').textContent = this.steps.toLocaleString();
      $('ai-loss').textContent = this.ema === null ? '–' : this.ema.toFixed(3);
      $('ai-speed').textContent = this.stepMs ? (1000 / this.stepMs).toFixed(1) + '/s' : '–';
      if (this.training) $('chip-model').textContent = 'training · loss ' + (this.ema || 0).toFixed(2);
      $('st-model').textContent = this.model
        ? this.model.paramCount().toLocaleString() + ' params · ' + this.steps + ' steps'
        : 'no model';
    },

    refreshInfo() {
      const p = PRESETS[$('ai-preset').value];
      const arch = p.nLayer + '-layer transformer · ' + p.nHead + ' heads · ' +
        p.nEmbd + '-d · ctx ' + p.blockSize;
      $('ai-arch').textContent = this.model
        ? arch + ' · ' + this.model.paramCount().toLocaleString() + ' params'
        : arch;
      this.refreshStats();
      if (!this.training) $('chip-model').textContent = this.model ? 'model: ' + this.steps + ' steps' : 'model: untrained';
    },

    generate(prompt, maxNew, opts, onChar, onDone) {
      if (!this.model) { logSys('train the model first (AI panel → Start training)'); if (onDone) onDone(false); return; }
      if (this.generating) return;
      this.generating = true;
      const ctx = Array.from(this.tok.encode(prompt.length ? prompt : '\n'));
      let i = 0;
      const step = () => {
        const t0 = performance.now();
        while (i < maxNew && performance.now() - t0 < 24) {
          const t = NN.nextToken(this.model, ctx, opts);
          ctx.push(t);
          onChar(this.tok.chars[t]);
          i++;
        }
        if (i < maxNew) setTimeout(step, 0);
        else { this.generating = false; if (onDone) onDone(true); }
      };
      step();
    },

    completeAtCursor() {
      if (!this.model) { logSys('train the model first (AI panel → Start training)'); return; }
      if (this.generating || activeFile === null) return;
      const pos = ed.selectionStart;
      const context = ed.value.slice(Math.max(0, pos - this.model.cfg.blockSize * 4), pos);
      let out = '';
      flashStatus('completing…');
      this.generate(context, 60, { temperature: 0.5, topK: 12 }, (ch) => { out += ch; }, (ok) => {
        if (!ok) return;
        ed.focus();
        ed.setSelectionRange(pos, pos);
        insertAtCursor(out);
        flashStatus('AI inserted ' + out.length + ' chars (Ctrl+Z to undo)');
      });
    },

    serialize() {
      return {
        format: 'neuroide-checkpoint-v1',
        chars: this.tok.chars,
        steps: this.steps,
        model: this.model.serialize(),
      };
    },

    loadCheckpoint(obj) {
      if (!obj || obj.format !== 'neuroide-checkpoint-v1') throw new Error('not a NeuroIDE checkpoint');
      this.stopTraining();
      this.tok = new NN.CharTokenizer(obj.chars.join(''));
      this.model = NN.CharLM.deserialize(obj.model);
      this.trainer = null;
      this.steps = obj.steps || 0;
      this.ema = null; this.lossHist = []; this.histStride = 1; this._sinceHist = 0;
      this.refreshInfo();
      drawChart();
      logSys('checkpoint loaded: ' + this.model.paramCount().toLocaleString() + ' params, ' + this.steps + ' steps');
    },
  };

  $('btn-train').addEventListener('click', () => {
    if (AI.training) AI.stopTraining();
    else AI.startTraining();
  });
  $('btn-reset-model').addEventListener('click', () => AI.reset());
  $('ai-preset').addEventListener('change', () => {
    if (AI.model) { AI.reset(); logSys('preset changed — model reset'); }
    AI.refreshInfo();
  });
  $('ai-corpus').addEventListener('change', () => {
    if (AI.model) { AI.reset(); logSys('corpus changed — model reset'); }
  });

  // sliders
  const bindSlider = (id, fmt) => {
    const s = $(id), v = $(id + '-v');
    const upd = () => { v.textContent = fmt ? fmt(s.value) : s.value; };
    s.addEventListener('input', upd);
    upd();
  };
  bindSlider('gen-temp', (x) => (x / 100).toFixed(2));
  bindSlider('gen-topk', (x) => (x === '0' ? 'off' : x));
  bindSlider('gen-len');

  $('btn-generate').addEventListener('click', () => {
    if (AI.generating) return;
    const out = $('gen-out');
    const prompt = $('gen-prompt').value;
    out.textContent = prompt;
    out.classList.add('busy');
    $('btn-generate').disabled = true;
    AI.generate(prompt, parseInt($('gen-len').value, 10), {
      temperature: parseFloat($('gen-temp').value) / 100,
      topK: parseInt($('gen-topk').value, 10),
    }, (ch) => {
      out.textContent += ch;
      out.scrollTop = out.scrollHeight;
    }, () => {
      out.classList.remove('busy');
      $('btn-generate').disabled = false;
    });
  });

  $('btn-insert').addEventListener('click', () => {
    const text = $('gen-out').textContent;
    if (!text || activeFile === null) return;
    ed.focus();
    insertAtCursor(text);
  });

  $('btn-complete').addEventListener('click', () => AI.completeAtCursor());

  // save / load model
  $('btn-save-model').addEventListener('click', () => {
    if (!AI.model) { logSys('no model to save — train one first'); return; }
    const blob = new Blob([JSON.stringify(AI.serialize())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'neuroide-model-' + AI.steps + 'steps.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    logSys('model checkpoint downloaded');
  });

  $('btn-load-model').addEventListener('click', () => $('model-file').click());
  $('model-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { AI.loadCheckpoint(JSON.parse(r.result)); }
      catch (err) { logSys('failed to load checkpoint: ' + err.message); }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  // ---------------------------------------------------------- loss chart ----
  const chart = $('loss-chart');
  function drawChart() {
    const ctx = chart.getContext('2d');
    const W = chart.width = chart.clientWidth * (window.devicePixelRatio || 1);
    const H = chart.height = chart.clientHeight * (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);
    const h = AI.lossHist;
    if (h.length < 2) {
      ctx.fillStyle = 'rgba(139,148,158,0.55)';
      ctx.font = (11 * (window.devicePixelRatio || 1)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('loss curve appears here during training', W / 2, H / 2);
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-6) hi = lo + 1e-6;
    const pad = 4 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    for (let i = 0; i < h.length; i++) {
      const x = pad + (W - 2 * pad) * (i / (h.length - 1));
      const y = pad + (H - 2 * pad) * (1 - (h[i] - lo) / (hi - lo));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(139,148,158,0.8)';
    ctx.font = (10 * (window.devicePixelRatio || 1)) + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(hi.toFixed(2), pad, 10 * (window.devicePixelRatio || 1));
    ctx.fillText(lo.toFixed(2), pad, H - pad);
  }
  window.addEventListener('resize', drawChart);

  // ------------------------------------------------------------- IDE API ----
  // Exposed for the chat agent (js/agent.js). Every mutating action the
  // agent performs through this API is gated behind a permission card.
  window.IDE = {
    FS,
    openFile,
    closeTab,
    renderFileList,
    renderTabs,
    langOf,
    runJS,
    runActiveFile,
    insertAtCursor,
    resetWorkspace,
    logSys,
    flashStatus,
    getActiveFile: () => activeFile,
    editor: ed,
    AI,
  };

  // ---------------------------------------------------------------- boot ----
  FS.load();
  loadTabs();
  renderFileList();
  renderTabs();
  if (activeFile) openFile(activeFile);
  AI.refreshInfo();
  drawChart();
  logSys('NeuroIDE ready — the neural net in js/nn.js is yours: no APIs, no libraries.');
  logSys('open the AI panel → Start training, then try Generate or Ctrl+Space.');
})();
