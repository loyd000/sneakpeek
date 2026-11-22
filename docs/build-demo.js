// Builds the landing page's live demo: a copy of the real widget (../index.html) that gets its data from
// site/demo.js instead of SneakPeek's background process. Run it after changing the widget:  node docs/build-demo.js
const fs = require('fs'), path = require('path');
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error('index.html changed, update build-demo.js: ' + from); html = html.replace(from, to); };
swap('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter.woff2');
swap('\n<script>\n', '\n<script src="demo.js"></script>\n<script>\n'); // the sample data has to exist before the widget's own script runs
fs.writeFileSync(path.join(__dirname, 'site', 'widget.html'), '<!-- Made by docs/build-demo.js from index.html. Edit index.html, not this. -->\n' + html);
console.log('docs/site/widget.html updated');
