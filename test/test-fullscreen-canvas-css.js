#!/usr/bin/env node
// Which CSS rule wins the guest canvas's `height` in each full-screen mode.
//
// WHY THIS TEST EXISTS (the bug, 8c731423): on a real iPhone the page went
// black while the app ran and painted correctly behind it. Two rules fight
// over the screen canvas in page-fullscreen mode --
//
//   body.page-fullscreen #screen-canvas-stack canvas   height: 100% !important
//   body.page-fullscreen canvas:not(#touch-cursor)     height: 0    !important
//
// -- because the second sizes the canvas as a FLEX ITEM (flex:1 1 0 plus
// height:0) while #screen-canvas-stack is display:block, so the flex
// properties do nothing and `height: 0` is taken literally. The stack-scoped
// rule used to win on specificity, until `:not(#touch-cursor)` was added to
// the bare rule (to stop the cursor sprite overflowing the page). `:not(#id)`
// counts as an ID, that tied both rules at (1,1,1), and a tie goes to the
// later rule in source order -- which is the height:0 one. Measured on the
// device: #screen and #screen-present 712x0 inside a 712x292 stack.
//
// WHY NO BROWSER: page-fullscreen is the fallback for a browser with NO
// element Fullscreen API, i.e. iPhone Safari, and `#screen-wrap:fullscreen`
// needs a real fullscreen transition that a headless run cannot grant. More
// to the point, the property under test is not layout at all -- it is which
// of two !important declarations the cascade picks, which is a deterministic
// function of (importance, specificity, source order) and needs no layout
// engine, no Chrome and no jsdom (which is not a dependency of this repo
// anyway). So the stylesheet is parsed here and the cascade arbitrated
// directly, and the failure message names the rule that WON and the rule it
// beat, which is the cause rather than the symptom.
//
// The parser refuses to skip anything it cannot understand: a selector it
// cannot parse is a hard failure whenever it mentions `canvas`, so a future
// selector shape cannot quietly drop out of the contest and leave this test
// passing over a rule it never considered.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// --- stylesheet extraction --------------------------------------------------

function extractStyle(html) {
  const open = html.indexOf('<style>');
  const close = html.indexOf('</style>', open);
  assert(open >= 0 && close > open, 'index.html must carry an inline <style> block');
  return html.slice(open + '<style>'.length, close);
}

function stripComments(css) {
  let out = '';
  for (let i = 0; i < css.length;) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      // Keep the newlines so reported line numbers stay honest.
      const skipped = css.slice(i, end < 0 ? css.length : end + 2);
      out += skipped.replace(/[^\n]/g, '');
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    out += css[i++];
  }
  return out;
}

// Flat list of { selectorText, decls, order, line }. @media/@supports blocks
// are flattened (a media query gates applicability, it does not change
// specificity, and no canvas-height rule lives in one today); @font-face and
// @keyframes are skipped because their blocks hold no selectors.
function parseRules(css, startLine) {
  const rules = [];
  const lineOf = index => startLine + css.slice(0, index).split('\n').length - 1;
  let order = 0;

  function walk(from, to) {
    let i = from;
    let prelude = '';
    let preludeStart = i;
    while (i < to) {
      const ch = css[i];
      if (ch === '{') {
        // Find the matching close brace.
        let depth = 1;
        let j = i + 1;
        while (j < to && depth > 0) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        const bodyEnd = j - 1;
        const text = prelude.trim();
        if (text.startsWith('@')) {
          const name = text.slice(1).split(/[\s({]/)[0].toLowerCase();
          if (name === 'media' || name === 'supports') walk(i + 1, bodyEnd);
          // @font-face, @keyframes, @page: no selectors inside, skip.
        } else if (text) {
          rules.push({
            selectorText: text,
            decls: parseDecls(css.slice(i + 1, bodyEnd)),
            order: order++,
            line: lineOf(preludeStart),
          });
        }
        i = j;
        prelude = '';
        preludeStart = i;
        continue;
      }
      if (ch === '}') { i++; prelude = ''; preludeStart = i; continue; }
      if (!prelude.trim() && /\s/.test(ch)) preludeStart = i + 1;
      prelude += ch;
      i++;
    }
  }

  walk(0, css.length);
  return rules;
}

function parseDecls(body) {
  const decls = [];
  for (const chunk of body.split(';')) {
    const text = chunk.trim();
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon < 0) continue;
    const prop = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important$/i, '').trim();
    }
    // A later duplicate of the same property inside one rule wins (the
    // `height: 100vh; height: 100dvh` pattern this page uses); keep them all
    // and let the cascade order sort it out, since order within a rule is
    // the declaration index.
    decls.push({ prop, value, important });
  }
  return decls;
}

// --- selectors: parse, specificity, matching --------------------------------
//
// A compound selector is { tag, id, classes[], pseudos[], nots[] }. A complex
// selector is a list of { combinator, compound }, subject last.

class SelectorError extends Error {}

function parseCompound(text) {
  const compound = { tag: null, id: null, classes: [], pseudos: [], nots: [] };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '*') { i++; continue; }
    if (ch === '#' || ch === '.') {
      const m = /^[-\w -￿]+/.exec(text.slice(i + 1));
      if (!m) throw new SelectorError(`bad name after ${ch} in "${text}"`);
      if (ch === '#') compound.id = m[0]; else compound.classes.push(m[0]);
      i += 1 + m[0].length;
      continue;
    }
    if (ch === ':') {
      const isElementPseudo = text[i + 1] === ':';
      const start = i + (isElementPseudo ? 2 : 1);
      const m = /^[-\w]+/.exec(text.slice(start));
      if (!m) throw new SelectorError(`bad pseudo in "${text}"`);
      let j = start + m[0].length;
      let arg = null;
      if (text[j] === '(') {
        let depth = 1;
        let k = j + 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '(') depth++;
          else if (text[k] === ')') depth--;
          k++;
        }
        arg = text.slice(j + 1, k - 1);
        j = k;
      }
      const name = m[0].toLowerCase();
      if (name === 'not') {
        if (!arg) throw new SelectorError(`:not() with no argument in "${text}"`);
        // Only simple arguments occur here; each argument is itself a compound.
        compound.nots.push(arg.split(',').map(part => parseCompound(part.trim())));
      } else if (isElementPseudo) {
        compound.pseudos.push({ name, elementPseudo: true });
      } else {
        compound.pseudos.push({ name, elementPseudo: false, arg });
      }
      i = j;
      continue;
    }
    const m = /^[-\w]+/.exec(text.slice(i));
    if (!m) throw new SelectorError(`unsupported selector syntax at "${text.slice(i)}" in "${text}"`);
    compound.tag = m[0].toLowerCase();
    i += m[0].length;
  }
  return compound;
}

function parseSelector(text) {
  const parts = [];
  // Only descendant and child combinators appear in this stylesheet; anything
  // else must fail loudly rather than be matched wrongly.
  const tokens = text.trim().split(/\s+/);
  let combinator = 'descendant';
  for (const token of tokens) {
    if (token === '>') { combinator = 'child'; continue; }
    if (token === '+' || token === '~') {
      throw new SelectorError(`unsupported combinator "${token}" in "${text}"`);
    }
    if (token.includes('>')) {
      // `a>b` with no spaces.
      const pieces = token.split('>');
      pieces.forEach((piece, index) => {
        if (!piece) return;
        parts.push({ combinator: index === 0 ? combinator : 'child', compound: parseCompound(piece) });
        combinator = 'child';
      });
      combinator = 'descendant';
      continue;
    }
    parts.push({ combinator, compound: parseCompound(token) });
    combinator = 'descendant';
  }
  if (!parts.length) throw new SelectorError(`empty selector "${text}"`);
  return parts;
}

function compoundSpecificity(compound) {
  const s = [0, 0, 0];
  if (compound.id) s[0]++;
  s[1] += compound.classes.length;
  for (const pseudo of compound.pseudos) {
    if (pseudo.elementPseudo) s[2]++;
    else s[1]++;
  }
  // `:not()` contributes the specificity of its most specific argument.
  for (const list of compound.nots) {
    let best = [0, 0, 0];
    for (const arg of list) {
      const inner = compoundSpecificity(arg);
      if (compareSpecificity(inner, best) > 0) best = inner;
    }
    s[0] += best[0]; s[1] += best[1]; s[2] += best[2];
  }
  if (compound.tag) s[2]++;
  return s;
}

function specificity(parts) {
  const total = [0, 0, 0];
  for (const part of parts) {
    const s = compoundSpecificity(part.compound);
    total[0] += s[0]; total[1] += s[1]; total[2] += s[2];
  }
  return total;
}

function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function matchesCompound(node, compound) {
  if (compound.tag && compound.tag !== node.tag) return false;
  if (compound.id && compound.id !== node.id) return false;
  for (const cls of compound.classes) if (!node.classes.has(cls)) return false;
  for (const pseudo of compound.pseudos) {
    if (pseudo.elementPseudo) return false; // ::backdrop etc. is not this element
    if (!node.pseudos.has(pseudo.name)) return false;
  }
  for (const list of compound.nots) {
    for (const arg of list) if (matchesCompound(node, arg)) return false;
  }
  return true;
}

// `chain` is root-to-element; the element under test is the last entry.
function matchesSelector(chain, parts) {
  function walk(partIndex, nodeIndex) {
    if (partIndex < 0) return true;
    const part = parts[partIndex];
    if (part.combinator === 'child' || partIndex === parts.length - 1) {
      if (nodeIndex < 0 || !matchesCompound(chain[nodeIndex], part.compound)) return false;
      return walk(partIndex - 1, nodeIndex - 1);
    }
    for (let i = nodeIndex; i >= 0; i--) {
      if (matchesCompound(chain[i], part.compound) && walk(partIndex - 1, i - 1)) return true;
    }
    return false;
  }
  // The subject compound must match the element itself.
  const last = parts.length - 1;
  if (!matchesCompound(chain[chain.length - 1], parts[last].compound)) return false;
  return walk(last - 1, chain.length - 2);
}

// --- the cascade ------------------------------------------------------------

function node(tag, { id = null, classes = [], pseudos = [] } = {}) {
  return { tag, id, classes: new Set(classes), pseudos: new Set(pseudos) };
}

function collect(rules, chain, property) {
  const hits = [];
  for (const rule of rules) {
    const values = rule.decls.filter(d => d.prop === property);
    if (!values.length) continue;
    for (const part of rule.selectorText.split(',')) {
      const text = part.trim();
      if (!text) continue;
      let parts;
      try {
        parts = parseSelector(text);
      } catch (error) {
        // A selector this test cannot read is only tolerable if it can have
        // nothing to do with a canvas. Otherwise the contest would be judged
        // over an incomplete field, which is exactly how the bug shipped.
        assert(!/canvas/i.test(text),
          `this test must understand every canvas selector in index.html; ` +
          `line ${rule.line}: ${error.message}`);
        continue;
      }
      if (!matchesSelector(chain, parts)) continue;
      const spec = specificity(parts);
      const winner = values[values.length - 1];
      hits.push({
        selector: text,
        line: rule.line,
        order: rule.order,
        spec,
        prop: property,
        value: winner.value,
        important: winner.important,
      });
      break; // one rule contributes once, at its most specific matching part
    }
  }
  return hits;
}

function rank(a, b) {
  if (a.important !== b.important) return a.important ? 1 : -1;
  const bySpec = compareSpecificity(a.spec, b.spec);
  if (bySpec !== 0) return bySpec;
  return a.order - b.order;
}

function describe(hit) {
  return `(${hit.spec.join(',')}) ${hit.selector} { ${hit.prop || 'height'}: ${hit.value}` +
    `${hit.important ? ' !important' : ''} }  [index.html:${hit.line}]`;
}

function winnerFor(rules, chain, property) {
  const hits = collect(rules, chain, property);
  if (!hits.length) return { winner: null, hits };
  const sorted = hits.slice().sort(rank);
  return { winner: sorted[sorted.length - 1], hits: sorted };
}

const ZERO = /^0(?:[a-z%]*)$/i;

// --- the scenarios ----------------------------------------------------------
//
// Each is a body class list plus, for the real-fullscreen modes, the
// pseudo-class the browser stamps on #screen-wrap. The DOM shape is index.html's
// own: #screen-wrap > #screen-canvas-stack > canvas#screen-present, canvas#screen.

const GUEST_CANVASES = ['screen', 'screen-present'];

function chainFor(bodyClasses, wrapPseudos, canvasId) {
  return [
    node('html'),
    node('body', { classes: bodyClasses }),
    node('div', { id: 'shell' }),
    node('div', { id: 'content' }),
    node('div', { id: 'screen-wrap', pseudos: wrapPseudos }),
    node('div', { id: 'screen-canvas-stack' }),
    node('canvas', { id: canvasId }),
  ];
}

const SCENARIOS = [
  // The bug itself. `no-debug` is the shipping shell; the bare form is ?debug.
  { name: 'page-fullscreen (shipping shell)', body: ['no-debug', 'page-fullscreen'], wrap: [] },
  { name: 'page-fullscreen (?debug)', body: ['page-fullscreen'], wrap: [] },
  { name: 'page-fullscreen + single-app', body: ['no-debug', 'single-app', 'app-running', 'page-fullscreen'], wrap: [] },
  // Entered by the scroll-to-collapse gesture; adds two more body classes,
  // which is exactly the kind of extra class that moves a cascade.
  { name: 'page-fullscreen + scroll-collapse', body: ['no-debug', 'page-fullscreen', 'scroll-collapse', 'bars-collapsed'], wrap: [] },
  // Same flex-item-in-a-block-box trap, different mode.
  { name: 'exclusive-fullscreen (shipping shell)', body: ['no-debug', 'exclusive-fullscreen', 'app-running'], wrap: [] },
  { name: 'exclusive-fullscreen (?debug)', body: ['exclusive-fullscreen', 'app-running'], wrap: [] },
  { name: 'exclusive-fullscreen + single-app', body: ['no-debug', 'single-app', 'app-running', 'exclusive-fullscreen'], wrap: [] },
  // Real browser fullscreen on #screen-wrap, both spellings. Listed twice on
  // purpose: with body.exclusive-fullscreen also set (what the consent button
  // produces) the stack-scoped exclusive rule out-specifies everything here
  // and would mask a defect in the :fullscreen rules themselves, so the plain
  // form -- a guest that took browser fullscreen without claiming an
  // exclusive display -- is the one that actually exercises them.
  { name: '#screen-wrap:fullscreen (with exclusive)', body: ['no-debug', 'exclusive-fullscreen', 'app-running'], wrap: ['fullscreen'] },
  { name: '#screen-wrap:-webkit-full-screen (with exclusive)', body: ['no-debug', 'exclusive-fullscreen', 'app-running'], wrap: ['-webkit-full-screen'] },
  { name: '#screen-wrap:fullscreen', body: ['no-debug', 'app-running'], wrap: ['fullscreen'] },
  { name: '#screen-wrap:-webkit-full-screen', body: ['no-debug', 'app-running'], wrap: ['-webkit-full-screen'] },
];

function main() {
  const css = stripComments(extractStyle(HTML));
  const styleLine = HTML.slice(0, HTML.indexOf('<style>')).split('\n').length;
  const rules = parseRules(css, styleLine);
  assert(rules.length > 100, `the stylesheet should parse into real rules, got ${rules.length}`);

  // Anchor: the selector shapes this test reasons about must still exist, or
  // every assertion below would pass over a stylesheet that no longer has the
  // contest in it.
  const selectors = rules.map(r => r.selectorText).join('\n');
  assert(/body\.page-fullscreen canvas/.test(selectors),
    'the bare page-fullscreen canvas rule is the hazard this test guards; it is gone');
  assert(/body\.page-fullscreen #screen-canvas-stack canvas/.test(selectors),
    'the stack-scoped page-fullscreen rule is the fix this test guards; it is gone');

  let checks = 0;
  for (const scenario of SCENARIOS) {
    for (const canvasId of GUEST_CANVASES) {
      const chain = chainFor(scenario.body, scenario.wrap, canvasId);
      const { winner, hits } = winnerFor(rules, chain, 'height');
      assert(winner,
        `${scenario.name}: no rule sizes #${canvasId} at all`);
      // A contest of one is a stylesheet that changed shape under this test.
      assert(hits.length >= 2,
        `${scenario.name}: expected competing height rules for #${canvasId}, ` +
        `found only ${hits.map(describe).join(' | ')}`);

      const losers = hits.filter(h => h !== winner).map(describe);
      assert(!ZERO.test(winner.value),
        `${scenario.name}: #${canvasId} resolves to height ${winner.value} -- a running app ` +
        `painting into nothing (the 8c731423 black-screen bug).\n` +
        `  WINNER ${describe(winner)}\n` +
        `  beat   ${losers.join('\n  beat   ')}\n` +
        `  That rule sizes the canvas as a FLEX ITEM, but #screen-canvas-stack is ` +
        `display:block, so height:0 is taken literally. The stack-scoped rule must ` +
        `out-specify it (two IDs beat one), not merely come first.`);

      // The other half of the same defect: the flex rule also forces
      // `position: relative; inset: auto`, which inside the block-level stack
      // stacks the two canvases instead of overlaying them.
      const position = winnerFor(rules, chain, 'position').winner;
      assert(position && position.value !== 'relative',
        `${scenario.name}: #${canvasId} resolves to position ${position && position.value} -- ` +
        `the flex-item rule won. The two guest canvases must overlay inside ` +
        `#screen-canvas-stack, not stack in flow.\n  WINNER ${position && describe(position)}`);
      checks++;
    }
  }

  // --- the cursor sprite ---------------------------------------------------
  //
  // #touch-cursor is a canvas appended to document.body (lib/touch-cursor.js),
  // NOT into #screen-wrap, and it is positioned by an inline
  // `position:fixed;left:0;top:0` plus an inline px width/height that follow
  // the finger. Inline style beats a normal stylesheet rule but LOSES to an
  // !important one -- so any `!important` rule that reaches it takes the
  // sprite over, lays it out at 100% of the viewport and lets a transform push
  // it past the right edge; a mobile browser answers horizontal overflow by
  // shrinking the whole page, one way, permanently. That is the bug the
  // `:not(#touch-cursor)` exclusions exist for, and `#screen-wrap:fullscreen
  // canvas` is a BARE canvas selector that would do the same -- it is safe
  // only because the sprite is not a descendant of #screen-wrap. Pin both
  // facts: the DOM placement, and that no !important geometry reaches it.
  const cursorSource = fs.readFileSync(path.join(ROOT, 'lib', 'touch-cursor.js'), 'utf8');
  assert(/el\.id = 'touch-cursor'/.test(cursorSource) &&
         /document\.body\.appendChild\(el\)/.test(cursorSource),
    'the cursor sprite must stay a body-level overlay: the bare `#screen-wrap:fullscreen canvas` ' +
    'rule would otherwise capture it and force it to 100% of the viewport');

  const GEOMETRY = ['width', 'height', 'position', 'inset', 'top', 'left', 'max-width', 'max-height'];
  for (const scenario of SCENARIOS) {
    const cursorChain = [
      node('html'),
      node('body', { classes: scenario.body }),
      node('canvas', { id: 'touch-cursor' }),
    ];
    for (const prop of GEOMETRY) {
      for (const hit of collect(rules, cursorChain, prop)) {
        assert(!hit.important,
          `${scenario.name}: an !important ${prop} reaches #touch-cursor and overrides the ` +
          `inline geometry lib/touch-cursor.js sets per frame -- the sprite then lays out at ` +
          `viewport size, a transform pushes it past the right edge, and the browser shrinks ` +
          `the whole page permanently.\n  ${hit.selector}  [index.html:${hit.line}]\n` +
          `  Exclude it with :not(#touch-cursor), as the other canvas rules do.`);
      }
    }
  }

  // --- the desktop teal ----------------------------------------------------
  //
  // "when in full screen need to make sure teal bg dont show through (Even as
  // page bg css or smth) ... as it currently shwos through behind iphone
  // status bar". The strip behind the notch is not drawn by the canvas and not
  // by any box in this stylesheet: it is the VIEWPORT background, which CSS
  // takes from <body> -- but only for as long as <html> has no background of
  // its own. Give html one and the propagation stops, the body's black becomes
  // a mere box, and the safe-area strips go back to whatever html says. So two
  // things are pinned here: every fullscreen mode resolves body to a
  // non-teal background, and html is left without one on purpose.
  // The Win98 desktop colour, in every spelling the stylesheet could use it.
  const TEAL = /(^|[^0-9a-f])(#008080|#088)\b|\bteal\b|rgba?\(\s*0\s*,\s*128\s*,\s*128\b/i;
  const BG = ['background', 'background-color'];
  const htmlChain = [node('html')];
  for (const prop of BG) {
    const hit = winnerFor(rules, htmlChain, prop).winner;
    assert(!hit,
      `index.html:${hit && hit.line} gives <html> a ${prop}. That stops the body's ` +
      `background propagating to the viewport, so the body's black becomes a mere box ` +
      `and the safe-area strip behind the iPhone's status bar goes back to whatever ` +
      `html says. Style body instead.\n  ${hit && describe(hit)}`);
  }
  // Only the modes where the BODY is the immersive surface. Real element
  // fullscreen puts #screen-wrap over everything and paints its own ::backdrop
  // (black, above), so the body behind it is never seen -- and that path is
  // not the iPhone's, which has no element Fullscreen API at all.
  const IMMERSIVE = SCENARIOS.filter(s =>
    s.body.includes('page-fullscreen') || s.body.includes('exclusive-fullscreen'));
  assert(IMMERSIVE.length >= 6, 'the fullscreen body modes are gone from SCENARIOS');
  let bgChecks = 0;
  for (const scenario of IMMERSIVE) {
    const bodyChain = [node('html'), node('body', { classes: scenario.body })];
    let winner = null;
    for (const prop of BG) {
      const hit = winnerFor(rules, bodyChain, prop).winner;
      if (hit && (!winner || rank(winner, hit) < 0)) winner = hit;
    }
    assert(winner,
      `${scenario.name}: nothing paints the body at all, so the viewport background is ` +
      `the browser default rather than the app's black`);
    assert(!TEAL.test(winner.value),
      `${scenario.name}: the body resolves to ${winner.value} -- the Win98 desktop's teal ` +
      `behind a full-screen app. It is the viewport background, so it shows in the ` +
      `safe-area strips the canvas never reaches (the notch, the home indicator) and in ` +
      `the overscroll rubber-band, which is exactly how it was reported.\n` +
      `  WINNER ${describe(winner)}`);
    bgChecks++;
  }
  // ...and the other direction, which is the part an over-eager fix breaks: a
  // WINDOWED app on the phone really is sitting on the Win98 desktop, and its
  // surround is supposed to be teal.
  for (const body of [['no-debug'], ['no-debug', 'single-app', 'app-running', 'windowed-phone']]) {
    const chain = [node('html'), node('body', { classes: body })];
    let winner = null;
    for (const prop of BG) {
      const hit = winnerFor(rules, chain, prop).winner;
      if (hit && (!winner || rank(winner, hit) < 0)) winner = hit;
    }
    assert(winner && TEAL.test(winner.value),
      `body.${body.join('.')} should keep the desktop teal -- a windowed app is ON the ` +
      `Win98 desktop -- but resolves to ${winner && winner.value}`);
  }
  // The page's own answer for the strip Safari paints rather than the page:
  // theme-color must not be hard-coded teal, and the script must flip it.
  assert(/name="theme-color"/.test(HTML), 'the theme-color meta is gone');
  assert(/syncFullscreenThemeColor/.test(HTML),
    'nothing flips <meta name="theme-color"> when an app takes the screen, so Safari ' +
    'keeps painting its status-bar strip with the desktop teal');

  console.log(`PASS  full-screen canvas cascade: ${checks} canvas/mode pairs keep a non-zero ` +
    `height and absolute placement; ${bgChecks} modes keep the desktop teal off the ` +
    `viewport background; no !important geometry reaches #touch-cursor`);
}

main();
