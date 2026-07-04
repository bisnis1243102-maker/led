// pretrain.js — train the shipped "pretrained brain" checkpoint in Node.
// Run: node tools/make-corpus.js && node tools/pretrain.js [steps]
// Writes models/pretrained.json (weights + tokenizer + metadata).
'use strict';
const fs = require('fs');
const path = require('path');
const NN = require('../js/nn.js');

const STEPS = parseInt(process.argv[2] || '6000', 10);
const corpusPath = path.join(__dirname, '..', 'models', 'corpus-large.txt');
const outPath = path.join(__dirname, '..', 'models', 'pretrained.json');

const corpus = fs.readFileSync(corpusPath, 'utf8');
NN.seed(20260703);

const tok = new NN.CharTokenizer(corpus);
// Same architecture as the app's "medium" preset, so the browser can keep
// training this checkpoint where the pretraining left off.
const CFG = { vocabSize: tok.vocabSize, blockSize: 48, nEmbd: 64, nLayer: 3, nHead: 4 };
const model = new NN.CharLM(CFG);
const trainer = new NN.Trainer(model, tok.encode(corpus), { batchSize: 6, lr: 2.5e-3 });

console.log('corpus:', (corpus.length / 1024).toFixed(1), 'KB · vocab', tok.vocabSize,
  '· params', model.paramCount().toLocaleString(), '· target', STEPS, 'steps');

function save(steps, loss) {
  const ckpt = {
    format: 'neuroide-checkpoint-v1',
    chars: tok.chars,
    steps,
    meta: {
      corpus: 'models/corpus-large.txt',
      corpusChars: corpus.length,
      finalLoss: loss,
      trainedBy: 'tools/pretrain.js (Node, CPU)',
      date: new Date().toISOString().slice(0, 10),
    },
    model: model.serialize(),
  };
  // round weights to shrink the JSON (~4 significant decimals is plenty)
  for (const k of Object.keys(ckpt.model.params)) {
    ckpt.model.params[k] = ckpt.model.params[k].map((v) => Math.round(v * 1e4) / 1e4);
  }
  fs.writeFileSync(outPath, JSON.stringify(ckpt));
  console.log('  saved', outPath, (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB');
}

const t0 = Date.now();
let ema = null;
for (let s = 1; s <= STEPS; s++) {
  // simple learning-rate decay in two drops
  if (s === Math.floor(STEPS * 0.6)) trainer.setLearningRate(1.2e-3);
  if (s === Math.floor(STEPS * 0.85)) trainer.setLearningRate(5e-4);
  const loss = trainer.step();
  ema = ema === null ? loss : ema * 0.98 + loss * 0.02;
  if (s % 200 === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log('step', s, '· loss', ema.toFixed(4), '·', (s / dt).toFixed(1), 'steps/s',
      '· eta', Math.round((STEPS - s) / (s / dt)) + 's');
  }
  if (s % 1000 === 0) save(s, ema);
}
save(STEPS, ema);

console.log('\n--- samples ---');
for (const prompt of ['You: hello\nBot:', 'function ', 'You: what is a loop\nBot:']) {
  console.log('\n### prompt: ' + JSON.stringify(prompt));
  console.log(prompt + NN.sample(model, tok, prompt, { maxNewTokens: 120, temperature: 0.5, topK: 10 }));
}
console.log('\nPRETRAIN DONE in', Math.round((Date.now() - t0) / 1000), 's · final loss', ema.toFixed(4));
