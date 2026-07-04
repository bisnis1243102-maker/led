// NLU test: train the intent classifier and check it on held-out
// paraphrases it never saw, plus slot extraction. Run: node tests/nlu.js
'use strict';
const NLU = require('../js/nlu.js');

const clf = new NLU.IntentClassifier();
const t0 = Date.now();
const stats = clf.train(NLU.DATASET);
console.log('trained on', stats.examples, 'examples,', stats.vocab, 'features,',
  'train acc', (stats.accuracy * 100).toFixed(1) + '%,', (Date.now() - t0) + 'ms');

// Held-out paraphrases — none of these strings are in the dataset.
const HELD_OUT = [
  ['could you make a file named todo.md', 'create_file'],
  ['please run main.js for me now', 'run_file'],
  ['get rid of the file old.txt for me', 'delete_file'],
  ['hey hows it going today', 'greet'],
  ['what exactly can you do for me', 'help'],
  ['put "hello world" into app.js', 'write_file'],
  ['train the network for 250 steps please', 'train_model'],
  ['hows the loss looking right now', 'model_status'],
  ['make up a little story for me', 'gen_text'],
  ['rename notes.txt to notes.md', 'rename_file'],
  ['show me all my files please', 'list_files'],
  ['please open main.js', 'open_file'],
  ['please stop the training now', 'stop_training'],
  ['wipe the model and start again', 'reset_model'],
  ['evaluate `1+1` for me', 'run_code'],
  ['whats 12 times 3', 'calc'],
  ['thank you so much that worked', 'thanks'],
  ['are you some kind of ai', 'who'],
  ['restore the default project files', 'reset_workspace'],
  ['add a function that subtracts two numbers to math.js', 'write_file'],
  ['please load your pretrained brain', 'load_pretrained'],
  ['can you get smarter', 'load_pretrained'],
];

let ok = 0;
for (const [text, want] of HELD_OUT) {
  const r = clf.classify(text);
  const hit = r.intent === want;
  if (hit) ok++;
  else console.log('  MISS:', JSON.stringify(text), '->', r.intent,
    '(' + r.confidence.toFixed(2) + ')', 'wanted', want);
}
console.log('held-out accuracy:', ok + '/' + HELD_OUT.length);
if (ok / HELD_OUT.length < 0.9) { console.error('FAIL: held-out accuracy < 90%'); process.exit(1); }

// ---- slots ----
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };

let r = clf.classify('rename a.js to b.js');
assert(r.slots.files[0] === 'a.js' && r.slots.files[1] === 'b.js', 'rename slots: ' + JSON.stringify(r.slots.files));

r = clf.classify('create a file called notes.md with "hello"');
assert(r.slots.files[0] === 'notes.md' && r.slots.strs[0] === 'hello', 'create slots');

assert(NLU.extractName('make a file called notes') === 'notes', 'extractName plain');
assert(NLU.extractName('create a file named my-lib.js') === 'my-lib.js', 'extractName ext');

r = clf.classify('train for 500 steps');
assert(r.slots.nums[0] === 500, 'train steps slot');

r = clf.classify('run `console.log(42)`');
assert(r.slots.code[0] === 'console.log(42)', 'code slot');

assert(NLU.mathExpr('what is 2 + 3 * 4') === '2 + 3 * 4', 'mathExpr basic: ' + NLU.mathExpr('what is 2 + 3 * 4'));
assert(NLU.mathExpr('whats 12 times 3') === '12 * 3', 'mathExpr words: ' + NLU.mathExpr('whats 12 times 3'));
assert(NLU.mathExpr('delete all my files') === null, 'mathExpr rejects non-math');

console.log('slot extraction: ok');
console.log('NLU TEST PASSED');
