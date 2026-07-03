/*
 * corpus.js — the starter project that appears in NeuroIDE's file explorer
 * on first launch, including train-data.txt, the default corpus the neural
 * network trains on. Everything is plain text baked into the app so it
 * works fully offline.
 */
(function (global) {
  'use strict';

  const WELCOME_MD = `# Welcome to NeuroIDE

NeuroIDE is a tiny IDE with a real neural network inside.
No APIs. No cloud. No ML libraries. The model is a miniature
GPT-style transformer written from scratch in plain JavaScript
(js/nn.js) and it trains **live, in this browser tab**.

## Chat with it

The 💬 **Chat** tab on the right understands plain English:

- "create a file called notes.md"
- "add a function that adds two numbers to main.js"
- "run main.js" · "what is 12 * 7"
- "train for 1000 steps", then "write something"

Anything that **edits files or runs code asks for your permission
first** — you'll see an Allow / Deny card in the chat. Your English is
parsed by a tiny intent classifier (js/nlu.js) trained from scratch in
~50ms when the page loads; the creative writing comes from the
transformer you train yourself.

## Quick start (the model tab)

1. Open the **🧠 Model** tab on the right and press **Start training**.
   Watch the loss curve fall — that is gradient descent running
   on your CPU right now.
2. After ~500 steps, type a prompt in **Generate** (try \`function \`)
   and press **Generate**.
3. Put your cursor in any file and press **Ctrl+Space** —
   the model autocompletes from your cursor position.
4. Open \`main.js\` and press **Ctrl+Enter** (or the Run button)
   to execute it in a sandbox. Output appears in the console below.

## The model learns from YOUR files

By default it trains on \`train-data.txt\`. Edit that file — or switch
the corpus to "All project files" — press **Reset model**, then train
again. The network will imitate whatever you feed it.

It is a character-level model with ~28k–200k parameters (a real GPT
has billions), so expect it to learn *style and structure*: bracket
matching, keywords, indentation, common phrases. It memorizes small
corpora and babbles plausibly on bigger ones. That's not a bug —
that's what a small brain looks like.

## IDE basics

- **New file**: + button in the explorer. Names ending in .js run.
- **Ctrl+S** save (files auto-save too, into localStorage)
- **Ctrl+Enter** run current .js file
- **Ctrl+Space** AI autocomplete at cursor
- Everything persists in your browser. "Reset workspace" starts over.

Have fun. You are holding a complete deep-learning stack:
tensors, autograd, attention, Adam — all inspectable in js/nn.js.
`;

  const MAIN_JS = `// main.js — press Ctrl+Enter (or the ▶ Run button) to execute.
// Runs in a sandboxed iframe; console output shows up below.

function greet(name) {
  return "hello, " + name + "!";
}

function fib(n) {
  if (n < 2) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return b;
}

console.log(greet("neuroide"));

for (let i = 1; i <= 10; i++) {
  console.log("fib(" + i + ") =", fib(i));
}

const scores = [12, 7, 42, 3, 25];
const total = scores.reduce((sum, x) => sum + x, 0);
console.log("total:", total, "max:", Math.max(...scores));
`;

  const HELLO_LUA = `-- hello.lua — syntax highlighting works for Lua too.
-- (Only .js files can be executed by the sandbox runner.)

local function greet(name)
  return "hello, " .. name .. "!"
end

local function sum(list)
  local total = 0
  for i = 1, #list do
    total = total + list[i]
  end
  return total
end

print(greet("neuroide"))
print("sum:", sum({ 1, 2, 3, 4, 5 }))

-- Tip: paste your own Lua here, switch the AI corpus to
-- "All project files", reset the model, and train — the
-- network will start writing Lua-flavored text.
`;

  // ------------------------------------------------------------------------
  // train-data.txt — the default training corpus. A character-level model
  // learns from raw characters, so this is deliberately repetitive and
  // structured: simple JavaScript with consistent style, plus short prose.
  // ------------------------------------------------------------------------
  const TRAIN_DATA = `// train-data.txt
// This is the food for the neural network. Edit me, then reset + train.
// The model reads raw characters and learns to predict the next one.

function add(a, b) {
  return a + b;
}

function sub(a, b) {
  return a - b;
}

function mul(a, b) {
  return a * b;
}

function div(a, b) {
  if (b === 0) {
    return 0;
  }
  return a / b;
}

function square(x) {
  return x * x;
}

function cube(x) {
  return x * x * x;
}

function isEven(n) {
  return n % 2 === 0;
}

function isOdd(n) {
  return n % 2 !== 0;
}

function max(a, b) {
  if (a > b) {
    return a;
  }
  return b;
}

function min(a, b) {
  if (a < b) {
    return a;
  }
  return b;
}

const one = 1;
const two = 2;
const three = 3;
const four = 4;
const five = 5;

console.log(add(one, two));
console.log(sub(five, three));
console.log(mul(two, four));
console.log(div(four, two));
console.log(square(three));
console.log(cube(two));

for (let i = 0; i < 10; i++) {
  console.log(i);
}

for (let i = 0; i < 10; i++) {
  if (isEven(i)) {
    console.log(i, "is even");
  } else {
    console.log(i, "is odd");
  }
}

while (true) {
  break;
}

function greet(name) {
  return "hello, " + name;
}

console.log(greet("world"));
console.log(greet("neuroide"));
console.log(greet("friend"));

const list = [1, 2, 3, 4, 5];

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total = total + list[i];
  }
  return total;
}

function count(list) {
  return list.length;
}

function first(list) {
  return list[0];
}

function last(list) {
  return list[list.length - 1];
}

console.log(sum(list));
console.log(count(list));
console.log(first(list));
console.log(last(list));

// the quick brown fox jumps over the lazy dog.
// the quick brown fox jumps over the lazy dog again.
// a small model can learn a small world.
// the network reads the text one character at a time.
// the network learns to predict the next character.
// train the model and the loss goes down.
// sample the model and the words come out.

function double(x) {
  return x * 2;
}

function triple(x) {
  return x * 3;
}

function half(x) {
  return x / 2;
}

function negate(x) {
  return -x;
}

console.log(double(21));
console.log(triple(7));
console.log(half(42));
console.log(negate(5));

if (one < two) {
  console.log("one is less than two");
}

if (five > four) {
  console.log("five is greater than four");
}

function repeat(text, times) {
  let out = "";
  for (let i = 0; i < times; i++) {
    out = out + text;
  }
  return out;
}

console.log(repeat("ha", 3));
console.log(repeat("na", 4));

function contains(list, value) {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) {
      return true;
    }
  }
  return false;
}

console.log(contains(list, 3));
console.log(contains(list, 9));

// gradient descent is a simple idea.
// take a small step downhill and repeat.
// the loss tells the model how wrong it is.
// the gradient tells the model which way to move.
// attention lets the model look back at the context.
// the model is small but the idea is the same as the big ones.

function clamp(x, lo, hi) {
  if (x < lo) {
    return lo;
  }
  if (x > hi) {
    return hi;
  }
  return x;
}

console.log(clamp(15, 0, 10));
console.log(clamp(-3, 0, 10));
console.log(clamp(7, 0, 10));

function abs(x) {
  if (x < 0) {
    return -x;
  }
  return x;
}

console.log(abs(-9));
console.log(abs(9));

function sign(x) {
  if (x > 0) {
    return 1;
  }
  if (x < 0) {
    return -1;
  }
  return 0;
}

console.log(sign(42));
console.log(sign(-42));
console.log(sign(0));

const names = ["ada", "alan", "grace", "linus", "marge"];

for (let i = 0; i < names.length; i++) {
  console.log(greet(names[i]));
}

function reverse(text) {
  let out = "";
  for (let i = text.length - 1; i >= 0; i--) {
    out = out + text[i];
  }
  return out;
}

console.log(reverse("stressed"));
console.log(reverse("neuroide"));

// the end of the corpus is the start of the loop.
// feed me more text and i will learn more words.
`;

  global.NEURO_DEFAULT_FILES = {
    'welcome.md': WELCOME_MD,
    'main.js': MAIN_JS,
    'hello.lua': HELLO_LUA,
    'train-data.txt': TRAIN_DATA,
  };
})(typeof self !== 'undefined' ? self : this);
