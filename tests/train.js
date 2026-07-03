// End-to-end training smoke test: train the mini-GPT on a small corpus in
// Node and verify the loss drops well below the uniform-distribution
// baseline, then print a sample. Run: node tests/train.js
'use strict';
const NN = require('../js/nn.js');

NN.seed(7);

const corpus = [
  'function greet(name) {',
  '  console.log("hello, " + name);',
  '}',
  'function add(a, b) {',
  '  return a + b;',
  '}',
  'for (let i = 0; i < 10; i++) {',
  '  console.log(add(i, i));',
  '}',
  'const message = "the quick brown fox jumps over the lazy dog";',
  'console.log(message);',
].join('\n') + '\n';

const tok = new NN.CharTokenizer(corpus.repeat(4));
const model = new NN.CharLM({ vocabSize: tok.vocabSize, blockSize: 32, nEmbd: 48, nLayer: 2, nHead: 2 });
console.log('vocab:', tok.vocabSize, ' params:', model.paramCount());

const trainer = new NN.Trainer(model, tok.encode(corpus.repeat(4)), { batchSize: 8, lr: 3e-3 });

const t0 = Date.now();
let firstLoss = null;
for (let s = 1; s <= 400; s++) {
  const loss = trainer.step();
  if (firstLoss === null) firstLoss = loss;
  if (s % 50 === 0) console.log('step', s, 'loss', loss.toFixed(4));
}
const dt = Date.now() - t0;
console.log('400 steps in', dt, 'ms  (', (dt / 400).toFixed(1), 'ms/step )');

const finalLoss = trainer.lastLoss;
console.log('loss:', firstLoss.toFixed(3), '->', finalLoss.toFixed(3),
  '(baseline ln(V) =', Math.log(tok.vocabSize).toFixed(3) + ')');

if (finalLoss > firstLoss * 0.5) {
  console.error('FAIL: loss did not decrease enough');
  process.exit(1);
}

console.log('\n--- sample (temperature 0.5) ---');
console.log(NN.sample(model, tok, 'function ', { maxNewTokens: 120, temperature: 0.5, topK: 8 }));
console.log('\nTRAIN TEST PASSED');
