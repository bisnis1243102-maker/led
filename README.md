# 🧠 NeuroIDE — an IDE with a from-scratch AI model inside

A browser-based code IDE with a **real neural network built completely from
scratch** — no APIs, no cloud, no ML libraries, no dependencies at all.
The AI is a miniature GPT-style transformer written in plain JavaScript,
and it **trains live in your browser tab** on your own files.

![what you get](#)
```
┌────────────┬──────────────────────────────┬──────────────────────┐
│ EXPLORER   │  tabs · editor · highlighting │  NEURAL NETWORK      │
│ hello.lua  │                              │  size / corpus       │
│ main.js    │  function greet(name) {      │  ▶ Start training    │
│ train-data │    return "hello, " + name;  │  loss curve 📉       │
│ welcome.md │  }                           │  ✨ Generate          │
│            ├──────────────────────────────┤  ⌨ Complete at cursor│
│            │  CONSOLE (sandboxed runner)  │  💾 Save / Load model │
└────────────┴──────────────────────────────┴──────────────────────┘
```

## Run it

No build step, no install:

```bash
# option 1: just open it
open index.html            # or double-click it

# option 2: serve it (nicer URLs)
python3 -m http.server 8000    # then visit http://localhost:8000

# option 3: single file
node build.js                  # produces dist/NeuroIDE.html — one
                               # self-contained file you can send to anyone
```

Everything (files, editor state) persists in your browser's localStorage.

## What's inside the AI (`js/nn.js`, ~600 lines, zero deps)

This is a complete deep-learning stack, not a wrapper:

| Piece | What it is |
|---|---|
| `Tensor` | 2-D tensors with **reverse-mode autodiff** (backprop) |
| Ops | matmul, bias-add, slice, GELU, LayerNorm, embeddings, fused **causal multi-head self-attention**, softmax cross-entropy |
| `Adam` | Adam optimizer with decoupled weight decay |
| `CharTokenizer` | character-level tokenizer built from your corpus |
| `CharLM` | a mini **GPT**: token + positional embeddings → N pre-norm transformer blocks (attention + MLP) → LM head |
| `Trainer` | mini-batch SGD loop over random corpus windows |
| `sample()` | autoregressive generation with temperature + top-k |

Model presets: **nano** (~28k params), **small** (~64k), **medium** (~183k).
For scale, GPT-2 was 124M and modern models are billions — this is a bonsai
tree, not a forest. It learns *structure and style*: brackets, keywords,
indentation, common phrases. Train it on a small corpus and it will
reproduce it almost perfectly; feed it more and it babbles plausibly.

## What the IDE does

- **File explorer** — create / rename (double-click) / delete files, persisted locally
- **Editor** — tabs, line numbers, syntax highlighting (JS, Lua, Markdown, JSON)
- **Runner** — `Ctrl+Enter` executes `.js` files in a sandboxed iframe; `console.log`
  output and errors appear in the built-in console
- **AI: train** — pick a corpus (`train-data.txt`, all project files, or the active
  file) and watch gradient descent happen: live loss curve, steps/sec
- **AI: generate** — prompt the model, tune temperature / top-k / length, insert
  the output into your file
- **AI: autocomplete** — `Ctrl+Space` completes at the cursor from your file's context
- **AI: checkpoints** — save the trained weights to a JSON file, load them back later

## Train it on your own stuff

1. Edit `train-data.txt` (or add files and pick corpus → *all project files*)
2. **Reset** the model, then **Start training**
3. Give it a few thousand steps — the lower the loss, the sharper the output
4. **Generate** with a prompt that looks like your data

## Tests

The math is verified — every gradient in the model is checked against
numerical differentiation, and a training run must converge:

```bash
node tests/gradcheck.js   # autodiff vs. finite differences (~1e-6 agreement)
node tests/train.js       # loss 3.7 → 0.1 in 400 steps + sample output
```

## Honest limitations

- It's a character-level model with tens of thousands of parameters —
  it will not answer questions or write your app. It imitates its corpus.
- Training uses one CPU core (plain JS, no WebGPU) — nano runs ~20-30 steps/s.
- The sandboxed runner can't stop an infinite loop in your code
  (close/reload the tab if you write one).

## Repo layout

```
index.html        app shell
style.css         dark IDE theme
js/nn.js          the neural network engine (the interesting file)
js/app.js         IDE logic: editor, tabs, runner, AI panel
js/corpus.js      starter files + default training corpus
tests/            gradient check + training smoke test (Node)
build.js          bundles everything into dist/NeuroIDE.html
```
