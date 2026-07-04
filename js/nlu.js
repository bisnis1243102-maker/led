/*
 * nlu.js — from-scratch natural-language understanding for NeuroIDE's chat.
 *
 * No APIs, no libraries. A tiny text classifier — bag-of-words + bigram
 * features into softmax regression, trained by SGD right here — maps plain
 * English to intents ("create a file called notes.md" -> create_file), and
 * a normalizer extracts slots: file names, quoted strings, numbers, `code`.
 *
 * Works in the browser (window.NLU) and in Node (module.exports) so the
 * classifier can be accuracy-tested from the command line.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.NLU = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ dataset ----
  // Training examples use placeholders that the normalizer also produces:
  //   <file> file name    <str> quoted string    <num> number    <code> `code`
  const DATASET = {
    greet: ['hi', 'hello', 'hey', 'hey there', 'good morning', 'good evening',
      'yo', 'hi there', 'hello there', 'whats up', 'how are you', 'sup',
      'hiya', 'morning', 'hows it going', 'good afternoon'],
    thanks: ['thanks', 'thank you', 'thanks a lot', 'thank you so much',
      'cheers', 'nice thanks', 'great thank you', 'awesome thanks',
      'perfect thanks', 'that worked thanks', 'ty', 'thx'],
    who: ['who are you', 'what are you', 'tell me about yourself',
      'what is this', 'what model are you', 'are you chatgpt', 'are you an ai',
      'what ai is this', 'introduce yourself', 'whats your name',
      'how do you work', 'are you a real ai', 'what are you built with'],
    help: ['help', 'what can you do', 'how do i use this',
      'show me what you can do', 'commands', 'list commands',
      'how does this work', 'what should i say', 'give me examples', 'usage',
      'what are your features', 'how do i get started', 'what do you do',
      'help me', 'show help'],
    list_files: ['list files', 'list my files', 'show files', 'show my files',
      'what files do i have', 'what files are there', 'show me the files',
      'ls', 'list all files', 'whats in my project', 'show the project files',
      'files', 'show me all files', 'what files exist'],
    create_file: ['create a file called <file>', 'make a new file <file>',
      'new file <file>', 'create <file>', 'make a file named <file>',
      'can you create <file>', 'add a new file called <file>',
      'create a new file named <file>', 'make me a file called <file>',
      'i need a new file <file>', 'create a file <file> with <str>',
      'make <file> containing <str>', 'new file called <file> that says <str>',
      'create an empty file <file>', 'make a file', 'create a new file',
      'make a file called notes', 'create a file named todo'],
    open_file: ['open <file>', 'show me <file>', 'open up <file>',
      'switch to <file>', 'go to <file>', 'can you open <file>',
      'take me to <file>', 'view <file>', 'display <file>', 'edit <file>',
      'open the file <file>', 'please open <file>'],
    delete_file: ['delete <file>', 'remove <file>', 'get rid of <file>',
      'delete the file <file>', 'trash <file>', 'can you delete <file>',
      'remove the file <file>', 'erase <file>', 'delete <file> please',
      'get rid of the file <file>', 'remove <file> from the project'],
    rename_file: ['rename <file> to <file>', 'change <file> to <file>',
      'rename the file <file> to <file>', 'move <file> to <file>',
      'change the name of <file> to <file>', 'call <file> <file> instead',
      'rename <file> as <file>', 'rename <file> into <file>'],
    write_file: ['write <str> to <file>', 'add <str> to <file>',
      'put <str> in <file>', 'append <str> to <file>',
      'add a line to <file> that says <str>', 'write <code> to <file>',
      'add <code> to <file>', 'put this in <file> <code>',
      'add a function that adds two numbers to <file>',
      'write a function called greet in <file>', 'add a comment to <file>',
      'add a console log that says <str> to <file>', 'append a note to <file>',
      'write hello world to <file>', 'add some code to <file>',
      'put <str> into <file>', 'add a function to <file>',
      'write a function that multiplies two numbers in <file>'],
    run_file: ['run <file>', 'execute <file>', 'run the file <file>',
      'run my code', 'run the current file', 'execute the active file',
      'run it', 'run this file', 'can you run <file>', 'execute my code',
      'run the program', 'launch <file>', 'test <file>',
      'run <file> for me', 'please run <file>'],
    run_code: ['run <code>', 'execute <code>', 'run this code <code>',
      'eval <code>', 'evaluate <code>', 'run the command <code>',
      'execute this <code>', 'try running <code>', 'run this snippet <code>',
      'execute the code <code>', 'run this javascript <code>',
      'can you run <code>'],
    calc: ['what is <num> plus <num>', 'calculate <num> + <num>',
      'whats <num> times <num>', 'compute <num> * <num>',
      'what is <num> - <num>', 'add <num> and <num>',
      'multiply <num> by <num>', 'what is <num> divided by <num>',
      'calculate <num> minus <num>', 'whats <num> plus <num> times <num>',
      'what is <num> * <num>', 'compute <num> / <num>',
      'whats <num> x <num>', 'what is <num> + <num> + <num>'],
    train_model: ['train', 'start training', 'train the model', 'train the ai',
      'start training the model', 'teach the model', 'train for <num> steps',
      'train the model for <num> steps', 'keep training', 'train more',
      'resume training', 'make it smarter', 'train it', 'begin training',
      'train the network', 'train the network for <num> steps',
      'train yourself', 'learn from my files'],
    stop_training: ['stop training', 'pause training', 'stop', 'pause',
      'halt training', 'stop the training', 'thats enough training',
      'pause the model', 'stop training now', 'enough training',
      'stop learning'],
    gen_text: ['write something', 'generate text', 'say something',
      'generate some text', 'write me something', 'make up some text',
      'generate', 'write a story', 'continue this <str>',
      'write something about <str>', 'generate text starting with <str>',
      'write some code', 'generate code', 'babble',
      'show me what youve learned', 'write something creative',
      'make up a story', 'say something in your own words',
      'generate something from <str>'],
    complete_cursor: ['complete at my cursor', 'autocomplete',
      'finish this line', 'complete this code', 'autocomplete here',
      'finish what im typing', 'complete the code at the cursor',
      'suggest a completion', 'finish my code', 'complete here',
      'autocomplete my code'],
    model_status: ['model status', 'hows training going', 'whats the loss',
      'how smart are you now', 'training status', 'how many steps',
      'whats your loss', 'how is the model doing', 'show model stats',
      'how trained are you', 'status', 'hows the loss looking',
      'how is training', 'show me the stats'],
    reset_model: ['reset the model', 'forget everything',
      'start the model over', 'wipe the model', 'reset the ai',
      'retrain from scratch', 'discard the model', 'reset model weights',
      'make the model forget', 'wipe the model and start over',
      'reset your brain'],
    save_model: ['save the model', 'download the model', 'save weights',
      'export the model', 'save a checkpoint', 'download weights',
      'save your brain', 'export weights', 'download a checkpoint'],
    load_model: ['load a model', 'load the model', 'import a model',
      'load weights', 'load a checkpoint', 'upload a model',
      'restore a model', 'import weights', 'load a saved model'],
    load_pretrained: ['load your brain', 'load the pretrained model',
      'load the pretrained brain', 'use the pretrained model', 'get smarter',
      'upgrade yourself', 'load the shipped model', 'install your brain',
      'load pretrained weights', 'be smarter', 'load the built in model',
      'wake up your brain', 'load your pretrained brain', 'become smarter'],
    reset_workspace: ['reset the workspace', 'restore default files',
      'reset everything', 'reset my files', 'start the workspace over',
      'factory reset', 'restore the default project', 'reset the project',
      'give me the default files back'],
    clear_chat: ['clear the chat', 'clear chat', 'clear this conversation',
      'wipe the chat', 'clear messages', 'start a new chat',
      'clear our conversation', 'erase the chat'],
  };

  // --------------------------------------------------------- normalizer ----
  const FILE_RE = /\b([\w-]+\.(?:js|mjs|md|markdown|txt|json|lua|html|htm|css))\b/gi;

  function normalize(text) {
    const slots = { files: [], strs: [], nums: [], code: [] };
    let t = ' ' + String(text).trim() + ' ';
    t = t.replace(/```([\s\S]*?)```|`([^`]*)`/g, (m, a, b) => {
      slots.code.push(a !== undefined ? a : b);
      return ' <code> ';
    });
    t = t.replace(/"([^"]*)"|'([^']*)'|“([^”]*)”/g, (m, a, b, c) => {
      slots.strs.push(a !== undefined ? a : (b !== undefined ? b : c));
      return ' <str> ';
    });
    t = t.replace(FILE_RE, (m, f) => { slots.files.push(f); return ' <file> '; });
    t = t.replace(/\b\d+(?:\.\d+)?\b/g, (m) => { slots.nums.push(parseFloat(m)); return ' <num> '; });
    t = t.toLowerCase();
    const tokens = t.match(/<\w+>|[a-z][a-z']*|[+\-*/%]/g) || [];
    return { tokens, slots, raw: String(text) };
  }

  function features(tokens) {
    const f = [];
    for (let i = 0; i < tokens.length; i++) {
      f.push(tokens[i]);
      if (i + 1 < tokens.length) f.push(tokens[i] + '_' + tokens[i + 1]);
    }
    return f;
  }

  // ---------------------------------------------------------- classifier ----
  // Sparse softmax regression trained with SGD. Small enough to train in
  // a few milliseconds, strong enough to hit ~100% on this domain.
  class IntentClassifier {
    constructor() {
      this.vocab = new Map();
      this.labels = [];
      this.W = null;   // Float64Array [vocab x classes]
      this.b = null;   // Float64Array [classes]
    }

    _featIds(tokens, grow) {
      const ids = [];
      for (const f of features(tokens)) {
        let id = this.vocab.get(f);
        if (id === undefined) {
          if (!grow) continue;
          id = this.vocab.size;
          this.vocab.set(f, id);
        }
        ids.push(id);
      }
      return ids;
    }

    train(dataset, opts) {
      opts = opts || {};
      const epochs = opts.epochs || 40;
      let lr = opts.lr || 0.25;
      this.labels = Object.keys(dataset);
      const C = this.labels.length;
      const examples = [];
      for (let y = 0; y < C; y++) {
        for (const utt of dataset[this.labels[y]]) {
          examples.push({ ids: this._featIds(normalize(utt).tokens, true), y });
        }
      }
      const V = this.vocab.size;
      this.W = new Float64Array(V * C);
      this.b = new Float64Array(C);
      // deterministic shuffle rng
      let s = 1234567;
      const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
      const order = examples.map((_, i) => i);
      for (let e = 0; e < epochs; e++) {
        for (let i = order.length - 1; i > 0; i--) {
          const j = (rnd() * (i + 1)) | 0;
          const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        for (const oi of order) {
          const ex = examples[oi];
          const p = this._probs(ex.ids);
          for (let c = 0; c < C; c++) {
            const g = p[c] - (c === ex.y ? 1 : 0);
            if (g === 0) continue;
            const step = lr * g;
            this.b[c] -= step;
            for (const id of ex.ids) this.W[id * C + c] -= step;
          }
        }
        lr *= 0.97;
      }
      // report training accuracy
      let correct = 0;
      for (const ex of examples) {
        const p = this._probs(ex.ids);
        let best = 0;
        for (let c = 1; c < C; c++) if (p[c] > p[best]) best = c;
        if (best === ex.y) correct++;
      }
      return { examples: examples.length, vocab: V, accuracy: correct / examples.length };
    }

    _probs(ids) {
      const C = this.labels.length;
      const sc = new Float64Array(C);
      for (let c = 0; c < C; c++) sc[c] = this.b[c];
      for (const id of ids) {
        const off = id * C;
        for (let c = 0; c < C; c++) sc[c] += this.W[off + c];
      }
      let mx = -Infinity;
      for (let c = 0; c < C; c++) if (sc[c] > mx) mx = sc[c];
      let z = 0;
      for (let c = 0; c < C; c++) { sc[c] = Math.exp(sc[c] - mx); z += sc[c]; }
      for (let c = 0; c < C; c++) sc[c] /= z;
      return sc;
    }

    classify(text) {
      const nl = normalize(text);
      const ids = this._featIds(nl.tokens, false);
      if (!this.W || ids.length === 0) {
        return { intent: 'unknown', confidence: 0, slots: nl.slots, raw: nl.raw, tokens: nl.tokens };
      }
      const p = this._probs(ids);
      let best = 0;
      for (let c = 1; c < this.labels.length; c++) if (p[c] > p[best]) best = c;
      return {
        intent: this.labels[best],
        confidence: p[best],
        slots: nl.slots,
        raw: nl.raw,
        tokens: nl.tokens,
      };
    }
  }

  // ------------------------------------------------------- slot helpers ----
  // "create a file called notes" — a name with no extension that FILE_RE
  // missed. Returns the word after called/named/file, or null.
  function extractName(raw) {
    let m = raw.match(/\b(?:called|named)\s+["'`]?([\w][\w.-]*)/i);
    if (m) return m[1];
    m = raw.match(/\bfile\s+["'`]?([\w][\w.-]*\.[\w]+)/i);
    if (m) return m[1];
    return null;
  }

  // Turn "what is 12 times 3 plus 4" into a safe arithmetic expression.
  // Returns the expression string or null if anything non-arithmetic remains.
  function mathExpr(raw) {
    let t = ' ' + raw.toLowerCase() + ' ';
    t = t.replace(/\b(?:whats|what is|what's|calculate|compute|eval(?:uate)?|solve|how much is)\b/g, ' ');
    t = t.replace(/\bplus\b/g, ' + ')
      .replace(/\bminus\b/g, ' - ')
      .replace(/\btimes\b/g, ' * ')
      .replace(/\bmultiplied by\b/g, ' * ')
      .replace(/\bx\b/g, ' * ')
      .replace(/\bdivided by\b/g, ' / ')
      .replace(/\bover\b/g, ' / ')
      .replace(/\bmod(?:ulo)?\b/g, ' % ')
      .replace(/\b(?:add|and)\b/g, ' + ')
      .replace(/\bmultiply\b/g, ' ')
      .replace(/\bby\b/g, ' * ')
      .replace(/[?,]/g, ' ');
    t = t.trim();
    if (!/^[\d+\-*/%().\s]+$/.test(t) || !/\d/.test(t)) return null;
    // no operators dangling at the ends
    t = t.replace(/^[+*/%\s]+|[+\-*/%\s]+$/g, '').trim();
    if (!t) return null;
    return t.replace(/\s+/g, ' ');
  }

  return { DATASET, normalize, features, IntentClassifier, extractName, mathExpr };
});
