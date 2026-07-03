/*
 * nn.js — a tiny neural-network engine + GPT-style language model, from scratch.
 *
 * No dependencies, no APIs, no ML libraries. Pure JavaScript.
 * Works in the browser (window.NN) and in Node (module.exports).
 *
 * What's inside:
 *   - Tensor: 2-D tensors (Float64Array) with reverse-mode autodiff
 *   - Ops: matmul, add, bias-add, slice, GELU, LayerNorm, embedding lookup,
 *          fused causal multi-head self-attention, softmax cross-entropy
 *   - Adam optimizer (decoupled weight decay)
 *   - CharTokenizer: character-level tokenizer
 *   - CharLM: a miniature GPT (token+positional embeddings, N transformer
 *             blocks with causal self-attention, LayerNorm, MLP, LM head)
 *   - Trainer: mini-batch training loop over a text corpus
 *   - sample(): autoregressive text generation (temperature + top-k)
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.NN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- RNG ----
  // Deterministic xorshift32 so runs are reproducible.
  let _seed = 1337 >>> 0;

  function seed(s) { _seed = (s >>> 0) || 1; }

  function rand() {
    _seed ^= _seed << 13; _seed >>>= 0;
    _seed ^= _seed >>> 17;
    _seed ^= _seed << 5; _seed >>>= 0;
    return _seed / 4294967296;
  }

  function randn() { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function randInt(n) { return Math.floor(rand() * n); }

  // ------------------------------------------------------------- Tensor ----
  class Tensor {
    constructor(rows, cols, data) {
      this.rows = rows;
      this.cols = cols;
      this.data = data || new Float64Array(rows * cols);
      this.grad = null;          // lazily allocated in backward
      this._prev = null;         // parent tensors in the graph
      this._backward = null;     // closure that propagates this.grad to parents
      this.requiresGrad = false; // true for trainable parameters
      this.name = null;
    }

    static zeros(rows, cols) { return new Tensor(rows, cols); }

    static randn(rows, cols, scale) {
      const t = new Tensor(rows, cols);
      const s = scale === undefined ? 1 : scale;
      for (let i = 0; i < t.data.length; i++) t.data[i] = randn() * s;
      return t;
    }

    static full(rows, cols, v) {
      const t = new Tensor(rows, cols);
      t.data.fill(v);
      return t;
    }

    get size() { return this.rows * this.cols; }

    ensureGrad() {
      if (!this.grad) this.grad = new Float64Array(this.size);
      return this.grad;
    }

    zeroGrad() { if (this.grad) this.grad.fill(0); }

    // Reverse-mode autodiff: topological sort, then walk backwards.
    backward() {
      const topo = [];
      const visited = new Set();
      (function build(t) {
        if (visited.has(t)) return;
        visited.add(t);
        if (t._prev) for (const p of t._prev) build(p);
        topo.push(t);
      })(this);
      this.ensureGrad().fill(0);
      this.grad[0] = 1;
      for (let i = topo.length - 1; i >= 0; i--) {
        if (topo[i]._backward) topo[i]._backward();
      }
    }
  }

  // ---------------------------------------------------------------- Ops ----

  // C = A @ B     A:[m,k]  B:[k,n]  ->  [m,n]
  function matmul(a, b) {
    const m = a.rows, k = a.cols, n = b.cols;
    if (b.rows !== k) throw new Error('matmul shape mismatch');
    const out = new Tensor(m, n);
    const A = a.data, B = b.data, C = out.data;
    for (let i = 0; i < m; i++) {
      const ai = i * k, ci = i * n;
      for (let p = 0; p < k; p++) {
        const av = A[ai + p];
        if (av === 0) continue;
        const bp = p * n;
        for (let j = 0; j < n; j++) C[ci + j] += av * B[bp + j];
      }
    }
    out._prev = [a, b];
    out._backward = function () {
      const dC = out.grad;
      const dA = a.ensureGrad(), dB = b.ensureGrad();
      // dA = dC @ B^T
      for (let i = 0; i < m; i++) {
        const ci = i * n, ai = i * k;
        for (let p = 0; p < k; p++) {
          let s = 0;
          const bp = p * n;
          for (let j = 0; j < n; j++) s += dC[ci + j] * B[bp + j];
          dA[ai + p] += s;
        }
      }
      // dB = A^T @ dC
      for (let i = 0; i < m; i++) {
        const ai = i * k, ci = i * n;
        for (let p = 0; p < k; p++) {
          const av = A[ai + p];
          if (av === 0) continue;
          const bp = p * n;
          for (let j = 0; j < n; j++) dB[bp + j] += av * dC[ci + j];
        }
      }
    };
    return out;
  }

  // Elementwise add, same shape.
  function add(a, b) {
    if (a.rows !== b.rows || a.cols !== b.cols) throw new Error('add shape mismatch');
    const out = new Tensor(a.rows, a.cols);
    const A = a.data, B = b.data, C = out.data;
    for (let i = 0; i < C.length; i++) C[i] = A[i] + B[i];
    out._prev = [a, b];
    out._backward = function () {
      const dC = out.grad;
      const dA = a.ensureGrad(), dB = b.ensureGrad();
      for (let i = 0; i < dC.length; i++) { dA[i] += dC[i]; dB[i] += dC[i]; }
    };
    return out;
  }

  // Add a [1,n] bias row to every row of a [m,n] tensor.
  function addBias(a, b) {
    if (b.rows !== 1 || b.cols !== a.cols) throw new Error('addBias shape mismatch');
    const m = a.rows, n = a.cols;
    const out = new Tensor(m, n);
    const A = a.data, B = b.data, C = out.data;
    for (let i = 0; i < m; i++) {
      const o = i * n;
      for (let j = 0; j < n; j++) C[o + j] = A[o + j] + B[j];
    }
    out._prev = [a, b];
    out._backward = function () {
      const dC = out.grad;
      const dA = a.ensureGrad(), dB = b.ensureGrad();
      for (let i = 0; i < m; i++) {
        const o = i * n;
        for (let j = 0; j < n; j++) { dA[o + j] += dC[o + j]; dB[j] += dC[o + j]; }
      }
    };
    return out;
  }

  // Column slice: out[i,j] = x[i, start+j]   (used to split fused QKV)
  function slice(x, start, width) {
    const m = x.rows, n = x.cols;
    const out = new Tensor(m, width);
    const X = x.data, C = out.data;
    for (let i = 0; i < m; i++) {
      const xi = i * n + start, ci = i * width;
      for (let j = 0; j < width; j++) C[ci + j] = X[xi + j];
    }
    out._prev = [x];
    out._backward = function () {
      const dC = out.grad;
      const dX = x.ensureGrad();
      for (let i = 0; i < m; i++) {
        const xi = i * n + start, ci = i * width;
        for (let j = 0; j < width; j++) dX[xi + j] += dC[ci + j];
      }
    };
    return out;
  }

  // GELU (tanh approximation), the GPT-2 activation.
  const GELU_C = Math.sqrt(2 / Math.PI);
  function gelu(x) {
    const out = new Tensor(x.rows, x.cols);
    const X = x.data, Y = out.data;
    for (let i = 0; i < X.length; i++) {
      const v = X[i];
      Y[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044715 * v * v * v)));
    }
    out._prev = [x];
    out._backward = function () {
      const dY = out.grad;
      const dX = x.ensureGrad();
      for (let i = 0; i < X.length; i++) {
        const v = X[i];
        const u = GELU_C * (v + 0.044715 * v * v * v);
        const t = Math.tanh(u);
        const du = GELU_C * (1 + 3 * 0.044715 * v * v);
        dX[i] += dY[i] * (0.5 * (1 + t) + 0.5 * v * (1 - t * t) * du);
      }
    };
    return out;
  }

  // Row-wise LayerNorm with learnable gain g and bias b (both [1,n]).
  function layerNorm(x, g, b) {
    const m = x.rows, n = x.cols;
    const out = new Tensor(m, n);
    const X = x.data, G = g.data, B = b.data, Y = out.data;
    const xhat = new Float64Array(m * n);
    const istd = new Float64Array(m);
    const EPS = 1e-5;
    for (let i = 0; i < m; i++) {
      const o = i * n;
      let mean = 0;
      for (let j = 0; j < n; j++) mean += X[o + j];
      mean /= n;
      let vsum = 0;
      for (let j = 0; j < n; j++) { const d = X[o + j] - mean; vsum += d * d; }
      const inv = 1 / Math.sqrt(vsum / n + EPS);
      istd[i] = inv;
      for (let j = 0; j < n; j++) {
        const h = (X[o + j] - mean) * inv;
        xhat[o + j] = h;
        Y[o + j] = G[j] * h + B[j];
      }
    }
    out._prev = [x, g, b];
    out._backward = function () {
      const dY = out.grad;
      const dX = x.ensureGrad(), dG = g.ensureGrad(), dB = b.ensureGrad();
      for (let i = 0; i < m; i++) {
        const o = i * n;
        let sum1 = 0, sum2 = 0;
        for (let j = 0; j < n; j++) {
          const dxh = dY[o + j] * G[j];
          sum1 += dxh;
          sum2 += dxh * xhat[o + j];
          dG[j] += dY[o + j] * xhat[o + j];
          dB[j] += dY[o + j];
        }
        const inv = istd[i];
        for (let j = 0; j < n; j++) {
          const dxh = dY[o + j] * G[j];
          dX[o + j] += inv * (dxh - sum1 / n - xhat[o + j] * sum2 / n);
        }
      }
    };
    return out;
  }

  // Embedding lookup: gather rows of `table` [V,C] by integer indices -> [N,C]
  function embedding(table, idx) {
    const N = idx.length, C = table.cols;
    const out = new Tensor(N, C);
    const T = table.data, Y = out.data;
    for (let i = 0; i < N; i++) {
      const t = idx[i] * C, o = i * C;
      for (let j = 0; j < C; j++) Y[o + j] = T[t + j];
    }
    out._prev = [table];
    out._backward = function () {
      const dY = out.grad;
      const dT = table.ensureGrad();
      for (let i = 0; i < N; i++) {
        const t = idx[i] * C, o = i * C;
        for (let j = 0; j < C; j++) dT[t + j] += dY[o + j];
      }
    };
    return out;
  }

  // Fused causal multi-head self-attention.
  // q,k,v: [B*T, C], nHead divides C. Returns [B*T, C].
  // For each batch b and head h:  out = softmax(mask(Q K^T / sqrt(hs))) V
  function causalSelfAttention(q, k, v, B, T, nHead) {
    const C = q.cols;
    const hs = C / nHead;
    if (hs !== Math.floor(hs)) throw new Error('nHead must divide nEmbd');
    const scale = 1 / Math.sqrt(hs);
    const out = new Tensor(q.rows, C);
    const Q = q.data, K = k.data, V = v.data, Y = out.data;
    // Cache attention probabilities for the backward pass.
    const P = new Float64Array(B * nHead * T * T);

    for (let b = 0; b < B; b++) {
      for (let h = 0; h < nHead; h++) {
        const hoff = h * hs;
        const pbase = (b * nHead + h) * T * T;
        for (let i = 0; i < T; i++) {
          const qi = (b * T + i) * C + hoff;
          const prow = pbase + i * T;
          // scores for j <= i, with running max for stable softmax
          let maxs = -Infinity;
          for (let j = 0; j <= i; j++) {
            const kj = (b * T + j) * C + hoff;
            let s = 0;
            for (let d = 0; d < hs; d++) s += Q[qi + d] * K[kj + d];
            s *= scale;
            P[prow + j] = s;
            if (s > maxs) maxs = s;
          }
          let denom = 0;
          for (let j = 0; j <= i; j++) {
            const e = Math.exp(P[prow + j] - maxs);
            P[prow + j] = e;
            denom += e;
          }
          const oi = (b * T + i) * C + hoff;
          for (let d = 0; d < hs; d++) Y[oi + d] = 0;
          for (let j = 0; j <= i; j++) {
            const p = P[prow + j] / denom;
            P[prow + j] = p;
            const vj = (b * T + j) * C + hoff;
            for (let d = 0; d < hs; d++) Y[oi + d] += p * V[vj + d];
          }
        }
      }
    }

    out._prev = [q, k, v];
    out._backward = function () {
      const dY = out.grad;
      const dQ = q.ensureGrad(), dK = k.ensureGrad(), dV = v.ensureGrad();
      for (let b = 0; b < B; b++) {
        for (let h = 0; h < nHead; h++) {
          const hoff = h * hs;
          const pbase = (b * nHead + h) * T * T;
          for (let i = 0; i < T; i++) {
            const prow = pbase + i * T;
            const oi = (b * T + i) * C + hoff;
            const qi = oi;
            // dP_ij = dY_i . V_j ;  dV_j += P_ij * dY_i
            // softmax backward: dS_ij = P_ij * (dP_ij - sum_k P_ik dP_ik)
            let dot = 0;
            const dP = new Float64Array(i + 1);
            for (let j = 0; j <= i; j++) {
              const vj = (b * T + j) * C + hoff;
              let s = 0;
              for (let d = 0; d < hs; d++) {
                s += dY[oi + d] * V[vj + d];
                dV[vj + d] += P[prow + j] * dY[oi + d];
              }
              dP[j] = s;
              dot += P[prow + j] * s;
            }
            for (let j = 0; j <= i; j++) {
              const dS = P[prow + j] * (dP[j] - dot) * scale;
              const kj = (b * T + j) * C + hoff;
              for (let d = 0; d < hs; d++) {
                dQ[qi + d] += dS * K[kj + d];
                dK[kj + d] += dS * Q[qi + d];
              }
            }
          }
        }
      }
    };
    return out;
  }

  // Softmax + mean cross-entropy, fused. logits:[N,V], targets: int array [N].
  // Returns a 1x1 loss tensor.
  function softmaxCrossEntropy(logits, targets) {
    const N = logits.rows, V = logits.cols;
    const L = logits.data;
    const probs = new Float64Array(N * V);
    let loss = 0;
    for (let i = 0; i < N; i++) {
      const o = i * V;
      let maxv = -Infinity;
      for (let j = 0; j < V; j++) if (L[o + j] > maxv) maxv = L[o + j];
      let denom = 0;
      for (let j = 0; j < V; j++) { const e = Math.exp(L[o + j] - maxv); probs[o + j] = e; denom += e; }
      for (let j = 0; j < V; j++) probs[o + j] /= denom;
      loss += -Math.log(probs[o + targets[i]] + 1e-12);
    }
    loss /= N;
    const out = new Tensor(1, 1);
    out.data[0] = loss;
    out._prev = [logits];
    out._backward = function () {
      const dL = logits.ensureGrad();
      const g = out.grad[0] / N;
      for (let i = 0; i < N; i++) {
        const o = i * V;
        for (let j = 0; j < V; j++) dL[o + j] += g * probs[o + j];
        dL[o + targets[i]] -= g;
      }
    };
    return out;
  }

  // ----------------------------------------------------------- Optimizer ----
  class Adam {
    constructor(params, opts) {
      opts = opts || {};
      this.params = params;
      this.lr = opts.lr !== undefined ? opts.lr : 1e-3;
      this.beta1 = opts.beta1 !== undefined ? opts.beta1 : 0.9;
      this.beta2 = opts.beta2 !== undefined ? opts.beta2 : 0.99;
      this.eps = opts.eps !== undefined ? opts.eps : 1e-8;
      this.weightDecay = opts.weightDecay !== undefined ? opts.weightDecay : 0.01;
      this.t = 0;
      for (const p of params) {
        p._m = new Float64Array(p.size);
        p._v = new Float64Array(p.size);
      }
    }

    zeroGrad() { for (const p of this.params) p.zeroGrad(); }

    step() {
      this.t++;
      const bc1 = 1 - Math.pow(this.beta1, this.t);
      const bc2 = 1 - Math.pow(this.beta2, this.t);
      for (const p of this.params) {
        if (!p.grad) continue;
        const d = p.data, g = p.grad, m = p._m, v = p._v;
        const wd = p.decay ? this.weightDecay : 0;
        for (let i = 0; i < d.length; i++) {
          m[i] = this.beta1 * m[i] + (1 - this.beta1) * g[i];
          v[i] = this.beta2 * v[i] + (1 - this.beta2) * g[i] * g[i];
          const mhat = m[i] / bc1;
          const vhat = v[i] / bc2;
          d[i] -= this.lr * (mhat / (Math.sqrt(vhat) + this.eps) + wd * d[i]);
        }
      }
    }
  }

  // ----------------------------------------------------------- Tokenizer ----
  class CharTokenizer {
    constructor(text) {
      const set = new Set(text);
      set.add('\n'); set.add(' ');
      this.chars = Array.from(set).sort();
      this.stoi = {};
      for (let i = 0; i < this.chars.length; i++) this.stoi[this.chars[i]] = i;
      this.vocabSize = this.chars.length;
      this.fallback = this.stoi[' '];
    }

    encode(str) {
      const out = new Int32Array(str.length);
      for (let i = 0; i < str.length; i++) {
        const t = this.stoi[str[i]];
        out[i] = t === undefined ? this.fallback : t;
      }
      return out;
    }

    decode(arr) {
      let s = '';
      for (let i = 0; i < arr.length; i++) s += this.chars[arr[i]];
      return s;
    }
  }

  // -------------------------------------------------------------- Model ----
  // A miniature GPT: char-level, learned positional embeddings, pre-norm
  // transformer blocks, untied LM head.
  class CharLM {
    constructor(cfg) {
      this.cfg = {
        vocabSize: cfg.vocabSize,
        blockSize: cfg.blockSize || 32,   // context length T
        nEmbd: cfg.nEmbd || 48,           // embedding width C
        nLayer: cfg.nLayer || 2,
        nHead: cfg.nHead || 2,
      };
      const { vocabSize: Vz, blockSize: T, nEmbd: C, nLayer: L, nHead: H } = this.cfg;
      if (C % H !== 0) throw new Error('nEmbd must be divisible by nHead');
      this.params = [];
      const reg = (name, t, decay) => {
        t.requiresGrad = true;
        t.name = name;
        t.decay = !!decay;
        this.params.push(t);
        return t;
      };
      const proj = 0.08 / Math.sqrt(2 * L); // scaled residual-projection init

      this.wte = reg('wte', Tensor.randn(Vz, C, 0.08), true);
      this.wpe = reg('wpe', Tensor.randn(T, C, 0.08), true);
      this.blocks = [];
      for (let l = 0; l < L; l++) {
        this.blocks.push({
          ln1g: reg('b' + l + '.ln1g', Tensor.full(1, C, 1)),
          ln1b: reg('b' + l + '.ln1b', Tensor.zeros(1, C)),
          qkvW: reg('b' + l + '.qkvW', Tensor.randn(C, 3 * C, 0.08), true),
          qkvB: reg('b' + l + '.qkvB', Tensor.zeros(1, 3 * C)),
          atW:  reg('b' + l + '.atW', Tensor.randn(C, C, proj), true),
          atB:  reg('b' + l + '.atB', Tensor.zeros(1, C)),
          ln2g: reg('b' + l + '.ln2g', Tensor.full(1, C, 1)),
          ln2b: reg('b' + l + '.ln2b', Tensor.zeros(1, C)),
          fcW:  reg('b' + l + '.fcW', Tensor.randn(C, 4 * C, 0.08), true),
          fcB:  reg('b' + l + '.fcB', Tensor.zeros(1, 4 * C)),
          prW:  reg('b' + l + '.prW', Tensor.randn(4 * C, C, proj), true),
          prB:  reg('b' + l + '.prB', Tensor.zeros(1, C)),
        });
      }
      this.lnfG = reg('lnfG', Tensor.full(1, C, 1));
      this.lnfB = reg('lnfB', Tensor.zeros(1, C));
      this.headW = reg('headW', Tensor.randn(C, Vz, 0.02), true);
      this.headB = reg('headB', Tensor.zeros(1, Vz));

      // reusable position-index buffers, keyed by (B,T)
      this._posCache = {};
    }

    paramCount() {
      let n = 0;
      for (const p of this.params) n += p.size;
      return n;
    }

    _posIdx(B, T) {
      const key = B + 'x' + T;
      let idx = this._posCache[key];
      if (!idx) {
        idx = new Int32Array(B * T);
        for (let b = 0; b < B; b++) for (let t = 0; t < T; t++) idx[b * T + t] = t;
        this._posCache[key] = idx;
      }
      return idx;
    }

    // xIdx: Int32Array of length B*T (tokens). targets: Int32Array B*T or null.
    forward(xIdx, B, T, targets) {
      if (T > this.cfg.blockSize) throw new Error('sequence longer than blockSize');
      const H = this.cfg.nHead, C = this.cfg.nEmbd;
      let x = add(embedding(this.wte, xIdx), embedding(this.wpe, this._posIdx(B, T)));
      for (const bl of this.blocks) {
        const h1 = layerNorm(x, bl.ln1g, bl.ln1b);
        const qkv = addBias(matmul(h1, bl.qkvW), bl.qkvB);
        const q = slice(qkv, 0, C), k = slice(qkv, C, C), v = slice(qkv, 2 * C, C);
        const att = causalSelfAttention(q, k, v, B, T, H);
        x = add(x, addBias(matmul(att, bl.atW), bl.atB));
        const h2 = layerNorm(x, bl.ln2g, bl.ln2b);
        const mlp = addBias(matmul(gelu(addBias(matmul(h2, bl.fcW), bl.fcB)), bl.prW), bl.prB);
        x = add(x, mlp);
      }
      x = layerNorm(x, this.lnfG, this.lnfB);
      const logits = addBias(matmul(x, this.headW), this.headB);
      const loss = targets ? softmaxCrossEntropy(logits, targets) : null;
      return { logits, loss };
    }

    serialize() {
      const params = {};
      for (const p of this.params) params[p.name] = Array.from(p.data);
      return { format: 'neuroide-charlm-v1', cfg: this.cfg, params };
    }

    static deserialize(obj) {
      const model = new CharLM(obj.cfg);
      for (const p of model.params) {
        const src = obj.params[p.name];
        if (!src || src.length !== p.size) throw new Error('bad checkpoint: ' + p.name);
        p.data.set(src);
      }
      return model;
    }
  }

  // ------------------------------------------------------------- Trainer ----
  class Trainer {
    constructor(model, dataIdx, opts) {
      opts = opts || {};
      this.model = model;
      this.batchSize = opts.batchSize || 8;
      this.opt = new Adam(model.params, { lr: opts.lr || 1e-3, weightDecay: opts.weightDecay });
      const T = model.cfg.blockSize;
      // Corpus must yield at least one (T+1)-window; tile it if too short.
      if (dataIdx.length < T + 2) {
        const reps = Math.ceil((T + 2) / dataIdx.length);
        const tiled = new Int32Array(dataIdx.length * reps);
        for (let r = 0; r < reps; r++) tiled.set(dataIdx, r * dataIdx.length);
        dataIdx = tiled;
      }
      this.data = dataIdx;
      this.steps = 0;
      this.lastLoss = null;
    }

    setLearningRate(lr) { this.opt.lr = lr; }

    step() {
      const T = this.model.cfg.blockSize, B = this.batchSize;
      const x = new Int32Array(B * T), y = new Int32Array(B * T);
      const maxStart = this.data.length - T - 1;
      for (let b = 0; b < B; b++) {
        const s = randInt(maxStart + 1);
        for (let t = 0; t < T; t++) {
          x[b * T + t] = this.data[s + t];
          y[b * T + t] = this.data[s + t + 1];
        }
      }
      this.opt.zeroGrad();
      const { loss } = this.model.forward(x, B, T, y);
      loss.backward();
      this.opt.step();
      this.steps++;
      this.lastLoss = loss.data[0];
      return this.lastLoss;
    }
  }

  // ------------------------------------------------------------ Sampling ----
  // Predict one next token given a context of token ids.
  // opts: {temperature, topK}. Returns the sampled token id.
  function nextToken(model, ctxIds, opts) {
    opts = opts || {};
    const temperature = Math.max(opts.temperature || 0.8, 1e-3);
    const topK = opts.topK || 0;
    const T = model.cfg.blockSize, V = model.cfg.vocabSize;
    const window = ctxIds.length > T ? ctxIds.slice(-T) : ctxIds;
    const t = window.length;
    const { logits } = model.forward(Int32Array.from(window), 1, t, null);
    const off = (t - 1) * V;
    const row = new Float64Array(V);
    for (let j = 0; j < V; j++) row[j] = logits.data[off + j] / temperature;
    if (topK > 0 && topK < V) {
      const sorted = Array.from(row).sort((a, b) => b - a);
      const cut = sorted[topK - 1];
      for (let j = 0; j < V; j++) if (row[j] < cut) row[j] = -Infinity;
    }
    let maxv = -Infinity;
    for (let j = 0; j < V; j++) if (row[j] > maxv) maxv = row[j];
    let denom = 0;
    for (let j = 0; j < V; j++) { row[j] = Math.exp(row[j] - maxv); denom += row[j]; }
    let r = rand() * denom, tok = V - 1;
    for (let j = 0; j < V; j++) { r -= row[j]; if (r <= 0) { tok = j; break; } }
    return tok;
  }

  // Autoregressive generation. opts: {maxNewTokens, temperature, topK, onToken}
  function sample(model, tokenizer, prompt, opts) {
    opts = opts || {};
    const maxNew = opts.maxNewTokens || 200;
    const ctx = Array.from(tokenizer.encode(prompt.length ? prompt : '\n'));
    let outStr = '';
    for (let n = 0; n < maxNew; n++) {
      const tok = nextToken(model, ctx, opts);
      ctx.push(tok);
      const ch = tokenizer.chars[tok];
      outStr += ch;
      if (opts.onToken) opts.onToken(ch);
    }
    return outStr;
  }

  return {
    Tensor, Adam, CharTokenizer, CharLM, Trainer,
    matmul, add, addBias, slice, gelu, layerNorm, embedding,
    causalSelfAttention, softmaxCrossEntropy,
    sample, nextToken, seed, rand, randn, randInt,
  };
});
