# 🧠 NeuroIDE — an IDE with a from-scratch AI model inside

A browser-based code IDE with a **real neural network built completely from
scratch** — no APIs, no cloud, no ML libraries, no dependencies at all.
The AI is a miniature GPT-style transformer written in plain JavaScript,
and it **trains live in your browser tab** on your own files.

It also has a **chat assistant that understands plain English** and can
create, edit, rename and delete files, and run code — but **only with your
permission**: every action shows an Allow / Deny card in the chat first.

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

## The chat assistant (`js/agent.js` + `js/nlu.js`)

Open the 💬 **Chat** tab and talk to it:

```
create a file called notes.md          rename a.js to b.js
add "hello" to notes.md                delete old.txt
add a function that adds two numbers to main.js
run main.js                            run `console.log(1+1)`
what is 12 * 7                         list files
train for 1000 steps                   write something
how's the loss?                        complete at my cursor
```

**How it understands English** — honestly: your message goes through a
text classifier built from scratch in `js/nlu.js` (bag-of-words + bigram
features → softmax regression, trained by SGD on ~300 example phrasings
in ~50ms when the page loads). It generalizes to phrasings it never saw
(22/22 on the held-out test set) and extracts file names, quoted text,
numbers and `code` from your sentence. Free-form *writing* comes from the
transformer. There is no cloud model anywhere.

**The pretrained brain** — say **"load your brain"** (or press ⚡ in the
Model tab). This loads `models/pretrained.json`: a ~162k-parameter
transformer pretrained offline by `tools/pretrain.js` on a 42KB corpus of
dialogue and JavaScript (`tools/make-corpus.js` — every line authored for
this project, no scraped data, no API). Once loaded, any chat message that
isn't a recognized command gets a **neural reply**, generated live by the
transformer in its trained dialogue style and labeled as such. The
checkpoint uses the same architecture as the "medium" preset, so you can
keep training it in the browser on your own files.

**The permission system** — the assistant never acts on its own:

- Creating, editing, renaming or deleting files → 🔒 permission card
- Running a file or a code snippet → 🔒 permission card
- Inserting completions into your editor → 🔒 permission card
- Resetting the model or workspace → 🔒 permission card
- Each card offers **Allow once**, **Always allow** (that action type,
  this session only), or **Deny**. Deny cancels the action entirely.
- Read-only things (listing files, status, math, chatting) don't ask.

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
node tests/nlu.js         # intent classifier: held-out English phrasings + slots
```

## Honest limitations

- The chat's English understanding covers IDE commands (files, running,
  training, generating) — it's an intent classifier, not a general
  conversationalist. Off-domain messages get a *neural reply* from the
  transformer: real generation, clearly labeled, charming, and only as
  smart as ~162k parameters can be. It answers best on topics in its
  training dialogue (coding terms, itself, the app).
- The generative model is character-level with tens of thousands of
  parameters — it imitates its training corpus rather than writing new
  programs. Code written *for* you ("a function that adds two numbers")
  comes from the assistant's built-in templates.
- Training uses one CPU core (plain JS, no WebGPU) — nano runs ~20-30 steps/s.
- The sandboxed runner can't stop an infinite loop in your code
  (close/reload the tab if you write one).

## Repo layout

```
index.html          app shell
style.css           dark IDE theme
js/nn.js            the neural network engine (the interesting file)
js/nlu.js           English → intent classifier + slot extraction (from scratch)
js/agent.js         chat assistant + the Allow/Deny permission system
js/app.js           IDE logic: editor, tabs, runner, AI panel
js/corpus.js        starter files + default training corpus
models/             pretrained checkpoint + the corpus it was trained on
tools/make-corpus.js  generates the pretraining corpus (all original text)
tools/pretrain.js   trains the shipped checkpoint in Node (CPU, no GPU)
tests/              gradient check, training test, NLU accuracy test (Node)
build.js            bundles everything (brain included) into dist/NeuroIDE.html
```
