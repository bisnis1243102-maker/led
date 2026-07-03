// build.js — bundle NeuroIDE into a single self-contained HTML file.
// Usage: node build.js   ->  dist/NeuroIDE.html
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
const css = read('style.css');
const scripts = ['js/nn.js', 'js/corpus.js', 'js/nlu.js', 'js/app.js', 'js/agent.js'].map(read).join('\n;\n');

html = html.replace('<link rel="stylesheet" href="style.css">',
  '<style>\n' + css + '\n</style>');
html = html.replace(
  /(?:<script src="js\/[\w.]+\.js"><\/script>\s*)+/,
  '<script>\n' + scripts.replace(/<\/script/gi, '<\\/script') + '\n</script>\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'NeuroIDE.html');
fs.writeFileSync(out, html);
console.log('wrote', out, '(' + (html.length / 1024).toFixed(1) + ' KB)');
