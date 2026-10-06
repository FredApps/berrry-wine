'use strict';
// Test helper: run the dashboard's browser scripts in a vm with an inert DOM
// so view functions can be rendered against a fixture snapshot.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browserApp(snapshot) {
  const element = () => ({onclick: null, textContent: '', innerHTML: '', value: '', title: '', open: false, classList: {add() {}, remove() {}, toggle() {}}, addEventListener() {}, querySelector: () => element(), showModal() {}, close() {}});
  const ctx = vm.createContext({
    console, Intl, Date, JSON, Math, Number, String, Set, Map, Promise, encodeURIComponent,
    location: {hash: ''}, window: {addEventListener() {}},
    document: {querySelector: element, getElementById: element, querySelectorAll: () => [], addEventListener() {}},
    fetch: () => new Promise(() => {}), setInterval() {},
  });
  ctx.globalThis = ctx;
  // Same order as index.html (terminal.js needs xterm and is not rendered here).
  for (const file of ['task-ui.js', 'approval-ui.js', 'blocker-model.js', 'release-model.js', 'dos-view.js', 'views.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx, {filename: file});
  ctx.__snapshot = snapshot;
  vm.runInContext('state = __snapshot;', ctx);
  return ctx;
}

module.exports = {browserApp};
