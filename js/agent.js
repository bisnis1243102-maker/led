/*
 * agent.js — NeuroIDE's chat assistant.
 *
 * Understands plain-English commands via the from-scratch intent classifier
 * in js/nlu.js (trained live at startup), uses the mini-GPT in js/nn.js for
 * free-form generation, and acts on the IDE through window.IDE.
 *
 * Safety model: every action with side effects — creating, editing,
 * renaming or deleting files, running code, resetting the model or the
 * workspace — is shown as a permission card first. Nothing executes until
 * the user clicks Allow. "Always allow" whitelists that action type for
 * the current session only.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const IDE = window.IDE;
  const AI = IDE.AI;
  const FS = IDE.FS;

  // ------------------------------------------------------------ chat DOM ----
  const log = $('chat-log');
  const input = $('chat-in');
  const form = $('chat-form');

  function scroll() { log.scrollTop = log.scrollHeight; }

  function addMsg(role, text, preText) {
    const m = document.createElement('div');
    m.className = 'msg msg-' + role;
    if (text) {
      const t = document.createElement('div');
      t.className = 'msg-text';
      t.textContent = text;
      m.appendChild(t);
    }
    if (preText !== undefined && preText !== null) {
      const p = document.createElement('pre');
      p.className = 'msg-pre';
      p.textContent = preText;
      m.appendChild(p);
    }
    log.appendChild(m);
    scroll();
    return m;
  }

  const bot = (text, pre) => addMsg('bot', text, pre);

  // ---------------------------------------------------------- permissions ----
  const PERM_LABEL = {
    files: 'file changes',
    run: 'running code',
    edit: 'editor edits',
    model: 'model resets',
    workspace: 'workspace resets',
  };
  const sessionAllow = {};

  // action: { type, title, preview?, run() }
  function withPermission(action) {
    if (sessionAllow[action.type]) {
      bot('✓ auto-allowed (' + PERM_LABEL[action.type] + ' are whitelisted this session)');
      action.run();
      return;
    }
    const card = document.createElement('div');
    card.className = 'perm-card';
    const title = document.createElement('div');
    title.className = 'perm-title';
    title.textContent = '🔒 Permission — ' + action.title;
    card.appendChild(title);
    if (action.preview) {
      const p = document.createElement('pre');
      p.className = 'perm-preview';
      p.textContent = action.preview;
      card.appendChild(p);
    }
    const row = document.createElement('div');
    row.className = 'perm-actions';
    const state = document.createElement('div');
    state.className = 'perm-state';

    const decide = (label, cls) => {
      row.remove();
      state.textContent = label;
      card.classList.add(cls);
      card.appendChild(state);
      scroll();
    };
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn perm-btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    mkBtn('Allow', 'primary', () => { decide('✓ allowed', 'ok'); action.run(); });
    mkBtn('Always allow ' + PERM_LABEL[action.type], 'subtle', () => {
      sessionAllow[action.type] = true;
      decide('✓ allowed — ' + PERM_LABEL[action.type] + ' whitelisted for this session', 'ok');
      action.run();
    });
    mkBtn('Deny', 'subtle deny', () => {
      decide('✗ denied', 'no');
      bot('Okay, I won\'t do that.');
    });
    card.appendChild(row);
    log.appendChild(card);
    scroll();
  }

  // --------------------------------------------------------------- brains ----
  let clf = null;

  function trainNLU() {
    clf = new NLU.IntentClassifier();
    const t0 = performance.now();
    const stats = clf.train(NLU.DATASET);
    IDE.logSys('chat intent model trained: ' + stats.examples + ' examples, ' +
      stats.vocab + ' features, ' + (stats.accuracy * 100).toFixed(0) + '% acc, ' +
      Math.round(performance.now() - t0) + 'ms');
  }

  // ------------------------------------------------------------- helpers ----
  function fileListText() {
    const names = FS.names();
    return names.map((n) => '  ' + n + '  (' + (FS.read(n) || '').length + ' chars)').join('\n');
  }

  function needFile(name, reply) {
    if (!name) { bot(reply); return null; }
    if (!FS.exists(name)) {
      bot('There\'s no file called ' + name + '. Your files:', fileListText());
      return null;
    }
    return name;
  }

  function afterFileChange(name) {
    IDE.renderFileList();
    if (name) IDE.openFile(name);
  }

  // Build file content from an English description.
  function synthContent(nl, targetName) {
    if (nl.slots.code.length) return { text: nl.slots.code.join('\n'), how: 'the code you gave me' };
    const raw = nl.raw;
    const isJs = IDE.langOf(targetName || '') === 'js';
    if (/\b(?:console\s*\.?\s*log|log|print)\b/i.test(raw) && nl.slots.strs.length && isJs) {
      return { text: 'console.log(' + JSON.stringify(nl.slots.strs[0]) + ');', how: 'a console.log' };
    }
    if (nl.slots.strs.length) return { text: nl.slots.strs.join('\n'), how: 'your quoted text' };
    if (/hello world/i.test(raw)) {
      return isJs
        ? { text: 'console.log("hello world");', how: 'a hello world' }
        : { text: 'hello world', how: 'a hello world' };
    }
    // "a function called X that does Y"
    const nameM = raw.match(/function (?:called |named )?([a-zA-Z_$][\w$]*)/i);
    const stop = ['that', 'to', 'in', 'into', 'which', 'and'];
    const fnName = nameM && !stop.includes(nameM[1].toLowerCase()) ? nameM[1] : null;
    const descM = raw.match(/that ([\w\s]+?)(?:\s+(?:to|in|into)\s+\S+)?\s*$/i);
    const desc = descM ? descM[1].trim() : null;
    if (fnName || desc || /\bfunction\b/i.test(raw)) {
      const d = (desc || '').toLowerCase();
      const KNOWN = [
        [/add/, 'add', ['a', 'b'], 'return a + b;'],
        [/subtract|minus/, 'subtract', ['a', 'b'], 'return a - b;'],
        [/multipl|times/, 'multiply', ['a', 'b'], 'return a * b;'],
        [/divid/, 'divide', ['a', 'b'], 'if (b === 0) return 0;\n  return a / b;'],
        [/greet|hello/, 'greet', ['name'], 'return "hello, " + name + "!";'],
        [/square/, 'square', ['x'], 'return x * x;'],
        [/double/, 'double', ['x'], 'return x * 2;'],
        [/revers/, 'reverse', ['text'], 'let out = "";\n  for (let i = text.length - 1; i >= 0; i--) out += text[i];\n  return out;'],
        [/sum|total/, 'sum', ['list'], 'let total = 0;\n  for (const x of list) total += x;\n  return total;'],
      ];
      for (const [re, defName, args, body] of KNOWN) {
        if (re.test(d)) {
          return {
            text: 'function ' + (fnName || defName) + '(' + args.join(', ') + ') {\n  ' + body + '\n}',
            how: 'a ' + (fnName || defName) + '() function',
          };
        }
      }
      const n = fnName || 'todo';
      return {
        text: 'function ' + n + '() {\n  // TODO: ' + (desc || 'implement ' + n) + '\n}',
        how: 'a function skeleton (tip: I know add/subtract/multiply/divide/greet/square/reverse/sum — or give exact code in `backticks`)',
      };
    }
    return {
      text: '// ' + raw,
      how: 'a comment (tip: put exact content in "quotes" or `backticks`)',
    };
  }

  // Run code in the sandbox and report captured output into the chat.
  function runCollected(source, label) {
    const lines = [];
    const msg = bot('Running ' + label + ' …');
    IDE.runJS(source, label, (entry) => {
      if (entry.type === 'done') {
        const outText = lines.length ? lines.slice(0, 14).join('\n') +
          (lines.length > 14 ? '\n… (' + (lines.length - 14) + ' more lines in the console)' : '') : '(no output)';
        msg.querySelector('.msg-text').textContent = '✓ Ran ' + label + ':';
        const p = document.createElement('pre');
        p.className = 'msg-pre';
        p.textContent = outText;
        msg.appendChild(p);
        scroll();
      } else {
        lines.push((entry.type === 'error' ? '✗ ' : '') + entry.text);
      }
    });
  }

  function trainFor(steps) {
    AI.startTraining();
    if (!steps) {
      bot('Training started — watch the loss curve in the 🧠 Model tab. Say "stop training" when you\'re happy (a few thousand steps works well), then ask me to write something.');
      return;
    }
    const target = AI.steps + steps;
    bot('Training for ' + steps + ' steps — I\'ll tell you when it\'s done.');
    const iv = setInterval(() => {
      if (!AI.training) { clearInterval(iv); return; }
      if (AI.steps >= target) {
        clearInterval(iv);
        AI.stopTraining();
        bot('Done — ' + AI.steps + ' steps total, loss ' + (AI.ema || 0).toFixed(3) +
          '. Lower loss = better imitation of the corpus. Ask me to "write something" to hear it.');
      }
    }, 300);
  }

  function generateInto(prompt, n, temp) {
    if (!AI.model) {
      bot('My text generator hasn\'t been trained yet — say "train the model" (or "train for 1000 steps") first. Training happens right here in your browser.');
      return;
    }
    const msg = bot('✍ (' + (AI.steps || 0) + '-step model writing…)', prompt);
    const pre = msg.querySelector('.msg-pre');
    AI.generate(prompt, n, { temperature: temp || 0.55, topK: 12 }, (ch) => {
      pre.textContent += ch;
      scroll();
    }, () => {
      msg.querySelector('.msg-text').textContent =
        '✍ From my neural net (char-level, ' + AI.model.paramCount().toLocaleString() +
        ' params — it imitates its training text):';
      scroll();
    });
  }

  // ---------------------------------------------------------------- state ----
  let pendingCreate = null; // waiting for a file name

  // ------------------------------------------------------------- handlers ----
  const HELP_TEXT = [
    'Files:    "create a file called notes.md" · "open main.js" · "delete old.txt"',
    '          "rename a.js to b.js" · "list files" · "add \'hello\' to notes.md"',
    '          "add a function that adds two numbers to main.js"',
    'Run:      "run main.js" · "run `console.log(1+1)`" · "what is 12 * 7"',
    'Model:    "load your brain" (pretrained!) · "train for 1000 steps"',
    '          "write something" · "how\'s the loss?" · "reset the model"',
    'Chat:     once a model is loaded, anything else gets a neural reply.',
    'Anything that changes files or runs code asks for your permission first.',
  ].join('\n');

  const handlers = {
    greet() {
      bot('Hey! I\'m the assistant built into NeuroIDE — I run entirely in your browser, no APIs. Tell me things like "create a file called app.js", "run main.js", or "train the model". I\'ll always ask before touching your files or running anything.');
    },
    thanks() { bot('Anytime! What next?'); },
    who() {
      bot('I\'m two small neural things stitched together, both written from scratch in plain JavaScript in this repo:\n' +
        '• my command understanding is a text classifier (js/nlu.js) trained in ~50ms when the page loaded — that\'s how I map your English to actions;\n' +
        '• my writing comes from a miniature GPT-style transformer (js/nn.js) that you train yourself on this project\'s files.\n' +
        'No ChatGPT, no cloud, no libraries — you can read every line of me. And I only edit files or run code after you click Allow.');
    },
    help() { bot('Here\'s what I understand:', HELP_TEXT); },
    list_files() { bot('Your project files:', fileListText()); },

    create_file(nl) {
      let name = nl.slots.files[0] || NLU.extractName(nl.raw);
      if (!name) {
        pendingCreate = true;
        bot('Sure — what should the file be called? (e.g. notes.md or app.js)');
        return;
      }
      if (!/\.[\w]+$/.test(name)) name += '.txt';
      if (FS.exists(name)) { bot(name + ' already exists — say "open ' + name + '" to edit it.'); return; }
      const content = nl.slots.strs.length ? nl.slots.strs.join('\n')
        : (nl.slots.code.length ? nl.slots.code.join('\n') : '');
      withPermission({
        type: 'files',
        title: 'create file ' + name + (content ? ' (' + content.length + ' chars)' : ' (empty)'),
        preview: content || null,
        run() {
          FS.write(name, content);
          afterFileChange(name);
          bot('✓ Created ' + name + (content ? ' with your content.' : ' — it\'s open in the editor.'));
        },
      });
    },

    open_file(nl) {
      const name = needFile(nl.slots.files[0], 'Which file? Say e.g. "open main.js".');
      if (!name) return;
      IDE.openFile(name);
      bot('✓ Opened ' + name + '.');
    },

    delete_file(nl) {
      const name = needFile(nl.slots.files[0], 'Which file should I delete?');
      if (!name) return;
      withPermission({
        type: 'files',
        title: 'delete file ' + name,
        preview: null,
        run() {
          FS.remove(name);
          IDE.closeTab(name);
          IDE.renderFileList();
          bot('✓ Deleted ' + name + '.');
        },
      });
    },

    rename_file(nl) {
      const from = nl.slots.files[0];
      let to = nl.slots.files[1];
      if (!to) {
        const m = nl.raw.match(/\b(?:to|as|into)\s+["'`]?([\w][\w.-]*)/i);
        if (m) to = m[1];
      }
      if (!needFile(from, 'Tell me both names, e.g. "rename a.js to b.js".')) return;
      if (!to) { bot('What should ' + from + ' be renamed to?'); return; }
      if (FS.exists(to)) { bot(to + ' already exists — pick another name.'); return; }
      withPermission({
        type: 'files',
        title: 'rename ' + from + ' → ' + to,
        run() {
          FS.write(to, FS.read(from));
          FS.remove(from);
          IDE.closeTab(from);
          afterFileChange(to);
          bot('✓ Renamed ' + from + ' to ' + to + '.');
        },
      });
    },

    write_file(nl) {
      const name = nl.slots.files[0] || IDE.getActiveFile();
      if (!needFile(name, 'Which file should I write to? e.g. "add \'hi\' to notes.md".')) return;
      const c = synthContent(nl, name);
      const existing = FS.read(name) || '';
      const appended = existing && !existing.endsWith('\n') ? existing + '\n' + c.text + '\n' : existing + c.text + '\n';
      withPermission({
        type: 'files',
        title: (existing ? 'append to ' : 'write to ') + name + ' — ' + c.how,
        preview: c.text,
        run() {
          FS.write(name, appended);
          afterFileChange(name);
          bot('✓ Added to ' + name + ' (' + c.how + ').');
        },
      });
    },

    run_file(nl) {
      const name = nl.slots.files[0] || IDE.getActiveFile();
      if (!needFile(name, 'Which file? Say "run main.js".')) return;
      if (IDE.langOf(name) !== 'js') { bot('I can only run .js files in the sandbox — ' + name + ' is ' + IDE.langOf(name) + '.'); return; }
      const src = FS.read(name) || '';
      withPermission({
        type: 'run',
        title: 'run ' + name + ' in the sandbox (' + src.length + ' chars)',
        preview: src.split('\n').slice(0, 6).join('\n') + (src.split('\n').length > 6 ? '\n…' : ''),
        run() { runCollected(src, name); },
      });
    },

    run_code(nl) {
      const code = nl.slots.code.join('\n');
      if (!code) { bot('Put the code in `backticks`, e.g. run `console.log(1+1)`.'); return; }
      withPermission({
        type: 'run',
        title: 'run this code in the sandbox',
        preview: code,
        run() { runCollected(code, 'your snippet'); },
      });
    },

    calc(nl) {
      const expr = NLU.mathExpr(nl.raw);
      if (!expr) { handlers.unknown(nl); return; }
      let val;
      try {
        // expr is regex-validated to digits/operators only — safe to evaluate
        val = Function('"use strict"; return (' + expr + ');')();
      } catch (e) { bot('That expression confused me: ' + expr); return; }
      bot(expr.replace(/\s+/g, ' ') + ' = ' + val);
    },

    train_model(nl) {
      if (AI.training) { bot('Already training — loss is ' + (AI.ema || 0).toFixed(3) + ' after ' + AI.steps + ' steps. Say "stop training" to pause.'); return; }
      trainFor(nl.slots.nums[0] ? Math.min(Math.round(nl.slots.nums[0]), 100000) : 0);
    },

    stop_training() {
      if (!AI.training) { bot('I wasn\'t training. Current model: ' + (AI.model ? AI.steps + ' steps, loss ' + (AI.ema || 0).toFixed(3) : 'untrained') + '.'); return; }
      AI.stopTraining();
      bot('⏸ Paused at ' + AI.steps + ' steps, loss ' + (AI.ema || 0).toFixed(3) + '.');
    },

    model_status() {
      if (!AI.model) { bot('The text model is untrained. Say "train for 1000 steps" and I\'ll learn from ' + $('ai-corpus').value + ' — all locally, on your CPU.'); return; }
      bot('Model: ' + AI.model.paramCount().toLocaleString() + ' params · ' + AI.steps + ' steps · loss ' +
        (AI.ema === null ? '–' : AI.ema.toFixed(3)) + (AI.training ? ' · training now (' + $('ai-speed').textContent + ')' : ' · paused') +
        '\nRough guide: loss 4 = random, 2 = letters look right, 1 = words look right, <0.5 = it knows the corpus well.');
    },

    reset_model() {
      withPermission({
        type: 'model',
        title: 'reset the model (forget all ' + (AI.model ? AI.steps : 0) + ' steps of training)',
        run() { AI.reset(); bot('✓ Model wiped. Say "train" to start fresh.'); },
      });
    },

    save_model() {
      if (!AI.model) { bot('Nothing to save yet — train the model first.'); return; }
      $('btn-save-model').click();
      bot('✓ Checkpoint download started (weights + tokenizer as JSON). Load it later with "load a model".');
    },

    load_model() {
      $('btn-load-model').click();
      bot('Pick a checkpoint .json file in the dialog.');
    },

    load_pretrained() {
      const doLoad = () => {
        bot('Loading my pretrained brain…');
        AI.loadPretrained((err) => {
          if (err) { bot('Couldn\'t load it: ' + err.message); return; }
          bot('⚡ Brain online: ' + AI.model.paramCount().toLocaleString() + ' params, pretrained for ' +
            AI.steps.toLocaleString() + ' steps on dialogue + code. Now you can just chat with me — ' +
            'anything I don\'t recognize as a command, my transformer answers itself. ' +
            'Try "tell me a joke" or "what is a gradient". (You can keep training me on the medium preset.)');
        });
      };
      if (AI.model && AI.steps > 0) {
        withPermission({
          type: 'model',
          title: 'replace the current model (' + AI.steps + ' steps) with the pretrained checkpoint',
          run: doLoad,
        });
      } else doLoad();
    },

    gen_text(nl) {
      let prompt = nl.slots.strs[0] || nl.slots.code[0];
      if (!prompt) {
        const m = nl.raw.match(/\b(?:about|on|starting with|continue(?: this)?:?)\s+(.+)$/i);
        if (m) prompt = m[1];
      }
      if (!prompt) prompt = /\bcode\b/i.test(nl.raw) ? 'function ' : '// ';
      generateInto(prompt, 220, 0.55);
    },

    complete_cursor() {
      if (!AI.model) { bot('Train me first — say "train for 1000 steps". Then I can complete at your cursor.'); return; }
      const file = IDE.getActiveFile();
      withPermission({
        type: 'edit',
        title: 'insert an AI completion at the cursor in ' + (file || 'the editor'),
        run() { AI.completeAtCursor(); bot('✓ Inserted a completion at your cursor (Ctrl+Z undoes it). You can also press Ctrl+Space in the editor any time.'); },
      });
    },

    reset_workspace() {
      withPermission({
        type: 'workspace',
        title: 'reset the workspace — restores default files, deletes your changes, reloads the page',
        run() { IDE.resetWorkspace(); },
      });
    },

    clear_chat() {
      log.innerHTML = '';
      welcome(true);
    },

    unknown(nl, guess) {
      // No command recognized: let the transformer answer in its own words.
      if (!guess && AI.model && !AI.generating) { neuralReply(nl.raw); return; }
      let t = 'I didn\'t quite get that.';
      if (guess) t = 'I\'m not sure — did you mean something like "' + guess + '"?';
      bot(t + ' I understand plain-English commands about files, running code, and the neural net' +
        (AI.model ? '' : ' — and once a model is loaded ("load your brain") I\'ll answer everything else neurally') +
        '. Say "help" for examples.');
    },
  };

  // Free-chat reply straight from the transformer, prompted in the
  // dialogue format it was trained on. Stops at the end of the Bot line.
  function neuralReply(text) {
    const prompt = 'You: ' + text.trim().slice(0, 120) + '\nBot:';
    const msg = bot('', '…');
    const pre = msg.querySelector('.msg-pre');
    let out = '';
    let stopped = false;
    AI.generate(prompt, 140, { temperature: 0.45, topK: 8 }, (ch) => {
      if (stopped) return false;
      out += ch;
      const cut = out.search(/\n(?:You|Bot):|\n\n/);
      if (cut >= 0) { stopped = true; pre.textContent = out.slice(0, cut).trim() || '…'; scroll(); return false; }
      pre.textContent = out.trim() || '…';
      scroll();
      return true;
    }, () => {
      if (!stopped) pre.textContent = (out.split('\n')[0].trim()) || '…';
      const label = document.createElement('div');
      label.className = 'neural-label';
      label.textContent = '🧪 neural reply — my ' + AI.model.paramCount().toLocaleString() +
        '-param transformer riffing, not a looked-up answer';
      msg.appendChild(label);
      scroll();
    });
  }

  const GUESS_EXAMPLES = {
    create_file: 'create a file called notes.md',
    delete_file: 'delete notes.md',
    rename_file: 'rename a.js to b.js',
    write_file: 'add "hello" to main.js',
    run_file: 'run main.js',
    run_code: 'run `console.log(1+1)`',
    open_file: 'open main.js',
    train_model: 'train for 1000 steps',
    gen_text: 'write something',
  };

  // --------------------------------------------------------------- router ----
  function route(text) {
    // follow-up: we asked for a file name
    if (pendingCreate) {
      const name = text.trim().match(/^["'`]?([\w][\w.-]*)["'`]?$/);
      pendingCreate = null;
      if (name) {
        handlers.create_file(NLU.normalize('create a file called ' + (/\./.test(name[1]) ? name[1] : name[1] + '.txt')));
        return;
      }
    }
    // slash commands, for the impatient
    if (text[0] === '/') {
      const [cmd, ...rest] = text.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      const map = {
        help: () => handlers.help(),
        ls: () => handlers.list_files(),
        run: () => handlers.run_file(NLU.normalize('run ' + arg)),
        rm: () => handlers.delete_file(NLU.normalize('delete ' + arg)),
        open: () => handlers.open_file(NLU.normalize('open ' + arg)),
        train: () => handlers.train_model(NLU.normalize('train for ' + (arg || '0') + ' steps')),
        gen: () => generateInto(arg || 'function ', 220, 0.55),
        clear: () => handlers.clear_chat(),
      };
      if (map[cmd]) { map[cmd](); return; }
    }
    const r = clf.classify(text);
    // arithmetic sometimes reads like other intents — trust the math parser
    if (r.intent !== 'calc' && NLU.mathExpr(r.raw) && /^[\s\d+\-*/%().?]+$/.test(text)) {
      handlers.calc(r);
      return;
    }
    // Purely conversational intents: once a model is loaded, only very
    // confident matches keep the canned reply — everything else goes to
    // the transformer, which was trained on far more small talk.
    const CHATTY = { greet: 1, thanks: 1, who: 1 };
    if (CHATTY[r.intent] && AI.model && r.confidence < 0.9) {
      handlers.unknown(r);
      return;
    }
    if (r.confidence >= 0.5 && handlers[r.intent]) {
      handlers[r.intent](r);
    } else if (r.confidence >= 0.3 && GUESS_EXAMPLES[r.intent]) {
      handlers.unknown(r, GUESS_EXAMPLES[r.intent]);
    } else {
      handlers.unknown(r);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    try { route(text); }
    catch (err) { bot('Ouch, I hit an error: ' + err.message); }
  });

  // ----------------------------------------------------------- panel tabs ----
  const tabs = document.querySelectorAll('.ptab');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.toggle('active', x === b));
    $('tab-chat').classList.toggle('hidden', b.dataset.tab !== 'chat');
    $('tab-model').classList.toggle('hidden', b.dataset.tab !== 'model');
    if (b.dataset.tab === 'chat') input.focus();
  }));

  // ----------------------------------------------------------------- boot ----
  function welcome(short) {
    bot('👋 Hi! I\'m NeuroIDE\'s built-in assistant — 100% local, no APIs, no keys. I understand English commands and I never touch your files or run code without your permission.');
    if (!short) {
      bot('Try me:', [
        '“create a file called notes.md”',
        '“add a function that adds two numbers to main.js”',
        '“run main.js”        “what is 12 * 7”',
        '“load your brain”   then just chat with me',
      ].join('\n'));
      if (AI.model) {
        bot('⚡ My pretrained brain is already loaded (' + AI.steps.toLocaleString() +
          ' steps) — ask me anything, e.g. "tell me a joke" or "what is a gradient".');
      }
    }
  }

  trainNLU();
  welcome(false);
  window.AGENT = { classify: (t) => clf.classify(t), route };
})();
