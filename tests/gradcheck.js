// Numerical gradient check for the full CharLM model.
// Verifies every parameter's analytic gradient (autodiff) against
// central finite differences. Run: node tests/gradcheck.js
'use strict';
const NN = require('../js/nn.js');

NN.seed(12345);

const V = 11, T = 6, B = 3;
const model = new NN.CharLM({ vocabSize: V, blockSize: T, nEmbd: 8, nLayer: 2, nHead: 2 });

// random batch
const x = new Int32Array(B * T), y = new Int32Array(B * T);
for (let i = 0; i < B * T; i++) { x[i] = NN.randInt(V); y[i] = NN.randInt(V); }

function lossValue() {
  return model.forward(x, B, T, y).loss.data[0];
}

// analytic grads
for (const p of model.params) p.zeroGrad();
const { loss } = model.forward(x, B, T, y);
loss.backward();
console.log('loss =', loss.data[0].toFixed(6), '(expect ~ln(V) =', Math.log(V).toFixed(3) + ')');

const EPS = 1e-5;
let worst = 0, worstName = '';
let checked = 0;
for (const p of model.params) {
  const g = p.grad || new Float64Array(p.size);
  // check a handful of random indices per tensor (plus first/last)
  const idxs = new Set([0, p.size - 1]);
  while (idxs.size < Math.min(8, p.size)) idxs.add(NN.randInt(p.size));
  for (const i of idxs) {
    const orig = p.data[i];
    p.data[i] = orig + EPS; const lp = lossValue();
    p.data[i] = orig - EPS; const lm = lossValue();
    p.data[i] = orig;
    const num = (lp - lm) / (2 * EPS);
    const ana = g[i];
    const denom = Math.max(Math.abs(num), Math.abs(ana), 1e-8);
    const rel = Math.abs(num - ana) / denom;
    checked++;
    if (rel > worst && denom > 1e-7) { worst = rel; worstName = p.name + '[' + i + ']'; }
    if (rel > 1e-4 && Math.abs(num - ana) > 1e-7) {
      console.error('FAIL', p.name, 'idx', i, 'numeric', num, 'analytic', ana, 'rel', rel);
      process.exit(1);
    }
  }
}
console.log('checked', checked, 'gradient entries across', model.params.length, 'tensors');
console.log('worst relative error:', worst.toExponential(3), 'at', worstName);
console.log('GRADCHECK PASSED');
