#!/usr/bin/env node
// Can home connections on a given ISP reach the site? Ask RIPE Atlas probes.
//
//   RIPE_ATLAS_KEY=... node tools/atlas-reach.js [--host=wine-assembly.berrry.app]
//       [--asn=2860,3243,12353,3320] [--per-asn=8] [--json=out.json]
//   node tools/atlas-reach.js --msm=ID[,ID]        # re-read finished measurements
//
// WHY THIS EXISTS: availability reports ("ERR_CONNECTION_RESET from Portugal")
// cannot be reproduced from data-centre vantage points — check-host.net and
// friends sit in hosting networks that ISP blocklists and consumer filtering
// never touch. RIPE Atlas probes are volunteers' boxes on real home lines, so a
// one-off `sslcert` measurement from them is a TLS handshake carrying our SNI,
// resolved with the probe's own DNS, from inside the ISP in question.
//
// Each --host gets one measurement over all requested probes. The report is a
// per-ASN tally of OK / reset / timeout / other, and the distinct error strings,
// so "MEO resets every handshake to *.berrry.app, NOS is fine" reads directly.
// Pass --host twice (berrry.app, docs.render.com) to split a name filter from an
// address block: those share the Render addresses but differ in SNI.
//
// Creating measurements spends Atlas credits (sslcert is cheap; 8 probes x 4
// ASNs x 2 hosts is a few hundred) and needs an API key with "create a new
// user defined measurement" permission in RIPE_ATLAS_KEY. Reading needs none.

'use strict';

const API = 'https://atlas.ripe.net/api/v2';
const ASN_NAMES = {
  2860: 'NOS (PT)', 3243: 'MEO (PT)', 12353: 'Vodafone (PT)', 20879: 'NOWO (PT)',
  3320: 'Deutsche Telekom (DE)', 3209: 'Vodafone (DE)', 8881: '1&1 Versatel (DE)', 6805: 'Telefonica (DE)',
};

function arg(name, def) {
  const hit = process.argv.slice(2).reverse().find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
}
function args(name) {
  return process.argv.slice(2).filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.key ? { Authorization: `Key ${opts.key}` } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function create(key, host, asns, perAsn) {
  const body = {
    definitions: [{
      type: 'sslcert', af: 4, target: host, hostname: host, port: 443,
      resolve_on_probe: true, description: `atlas-reach ${host}`,
    }],
    probes: asns.map(a => ({ type: 'asn', value: a, requested: perAsn })),
    is_oneoff: true,
  };
  const r = await api('/measurements/', { method: 'POST', body: JSON.stringify(body), key });
  return r.measurements[0];
}

// Atlas reports failures as free text; bucket the ones that discriminate.
function classify(r) {
  if (r.cert && r.cert.length) return 'ok';
  const e = String(r.err || (r.alert && JSON.stringify(r.alert)) || 'no result').toLowerCase();
  if (e.includes('reset')) return 'reset';
  if (e.includes('timeout') || e.includes('timed out')) return 'timeout';
  if (e.includes('dns') || e.includes('name or service') || e.includes('resolv')) return 'dns';
  return 'other';
}

async function report(msmId) {
  const msm = await api(`/measurements/${msmId}/`);
  const results = await api(`/measurements/${msmId}/results/`);
  const ids = [...new Set(results.map(r => r.prb_id))];
  const asnOf = {};
  for (let i = 0; i < ids.length; i += 100) {
    const page = await api(`/probes/?id__in=${ids.slice(i, i + 100).join(',')}&page_size=100`);
    for (const p of page.results) asnOf[p.id] = p.asn_v4;
  }
  const byAsn = {};
  for (const r of results) {
    const asn = asnOf[r.prb_id] || 'unknown';
    const row = byAsn[asn] || (byAsn[asn] = { ok: 0, reset: 0, timeout: 0, dns: 0, other: 0, errors: new Set(), addrs: new Set() });
    row[classify(r)]++;
    if (r.err) row.errors.add(String(r.err).slice(0, 80));
    if (r.dst_addr) row.addrs.add(r.dst_addr);
  }
  console.log(`\nmsm ${msmId}  ${msm.target}  status=${msm.status.name}  results=${results.length}`);
  for (const [asn, row] of Object.entries(byAsn)) {
    const name = ASN_NAMES[asn] || '';
    console.log(`  AS${asn} ${name.padEnd(22)} ok=${row.ok} reset=${row.reset} timeout=${row.timeout} dns=${row.dns} other=${row.other}  addr=${[...row.addrs].join(',')}`);
    for (const e of row.errors) console.log(`      err: ${e}`);
  }
  return { msm: msmId, target: msm.target, status: msm.status.name, results };
}

async function main() {
  const out = [];
  const reread = arg('msm');
  if (reread) {
    for (const id of String(reread).split(',')) out.push(await report(id));
  } else {
    const key = process.env.RIPE_ATLAS_KEY;
    if (!key) { console.error('RIPE_ATLAS_KEY is not set (https://atlas.ripe.net/keys/)'); process.exit(2); }
    const hosts = args('host').length ? args('host') : ['wine-assembly.berrry.app'];
    const asns = String(arg('asn', '2860,3243,12353,3320')).split(',').map(Number);
    const perAsn = Number(arg('per-asn', 8));
    const ids = [];
    for (const h of hosts) {
      const id = await create(key, h, asns, perAsn);
      console.log(`created msm ${id} for ${h}  https://atlas.ripe.net/measurements/${id}/`);
      ids.push(id);
    }
    // One-offs usually report within a few minutes; poll until stopped or 10 min.
    const deadline = Date.now() + 10 * 60 * 1000;
    for (const id of ids) {
      for (;;) {
        const m = await api(`/measurements/${id}/`);
        if (['Stopped', 'Failed', 'No suitable probes'].includes(m.status.name) || Date.now() > deadline) break;
        await new Promise(r => setTimeout(r, 20000));
      }
      out.push(await report(id));
    }
    console.log(`\nre-read later: node tools/atlas-reach.js --msm=${ids.join(',')}`);
  }
  const json = arg('json');
  if (json) require('fs').writeFileSync(json, JSON.stringify(out, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
