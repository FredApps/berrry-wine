'use strict';
// Offline original-image analysis; never executes or changes guest code.
const fs = require('fs'), crypto = require('crypto');
const ORIGINAL_SHA = 'a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4';
function image(bytes, expected = ORIGINAL_SHA) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected) throw Error('original image identity');
  function u(at) { if (!Number.isInteger(at) || at < 0 || at + 2 > bytes.length) throw Error('NE bounds'); return bytes.readUInt16LE(at); }
  if (bytes.length < 64 || u(0) !== 0x5a4d) throw Error('MZ');
  const ne = bytes.readUInt32LE(60); if (u(ne) !== 0x454e) throw Error('NE');
  const count = u(ne + 28), shift = u(ne + 50), table = ne + u(ne + 34);
  if (!count || count > 4096 || shift > 16) throw Error('NE segment bounds');
  const segments = [];
  for (let number = 1; number <= count; number++) {
    const a = table + (number - 1) * 8, sector = u(a), length = u(a + 2) || 65536, flags = u(a + 4);
    const offset = sector * 2 ** shift;
    // Zero-sector segments are allocation-only, not file bytes at offset zero.
    if (!sector) { segments.push({number, flags, length, allocationOnly: true, relocations: []}); continue; }
    if (offset + length > bytes.length) throw Error('NE segment range');
    const relocations = [], sites = new Map();
    if (flags & 0x100) {
      const rt = offset + length, records = u(rt);
      if (records > 4096 || rt + 2 + records * 8 > bytes.length) throw Error('NE relocation range');
      for (let j = 0; j < records; j++) {
        const r = rt + 2 + j * 8, type = bytes[r] & 15, relocationFlags = bytes[r + 1];
        const width = ({0: 1, 2: 2, 3: 4, 5: 2})[type];
        if (!width) throw Error('NE relocation type');
        let site = u(r + 2); const seen = new Set();
        while (site !== 65535) {
          if (seen.has(site) || site + width > length) throw Error('NE relocation chain');
          seen.add(site);
          const record = {record: j, site, type, flags: relocationFlags, target: u(r + 4), value: u(r + 6), width};
          relocations.push(record);
          for (let k = 0; k < width; k++) { if (sites.has(site + k)) throw Error('overlapping relocation'); sites.set(site + k, record); }
          if (relocationFlags & 4) break;
          site = u(offset + site);
        }
      }
    }
    segments.push({number, offset, length, flags, relocations, sites});
  }
  function segment(number) { const s = segments[number - 1]; if (!s || s.allocationOnly) throw Error('segment has no original bytes'); return s; }
  function authenticate(number, start, captured) {
    const s = segment(number);
    if (!Number.isInteger(start) || start < 0 || start + captured.length > s.length) throw Error('authentication range');
    const differences = [];
    for (let i = 0; i < captured.length; i++) if (captured[i] !== bytes[s.offset + start + i]) differences.push({offset: start + i, original: bytes[s.offset + start + i], captured: captured[i], relocation: s.sites.get(start + i) || null});
    return {segment: number, start, length: captured.length, authenticated: differences.every(d => d.relocation), differences, limitation: 'byte identity except original relocation sites; authenticate relocated selector targets separately'};
  }
  return {bytes, sha256, segments, segment, authenticate, u};
}
function contract(original) {
  const s = original.segment(1), b = original.bytes;
  // Original ten-byte message-map records, located by the existing RE image.
  const records = [0xa35a, 0xa364].map(offset => {
    const a = s.offset + offset;
    const r = s.sites.get(offset + 8);
    if (!r || r.type !== 2 || (r.flags & 3) !== 0 || r.target !== 4) throw Error('message-map selector relocation');
    return {segment: 1, offset, message: original.u(a), reserved: original.u(a + 2), argumentBytes: original.u(a + 4), handlerOffset: original.u(a + 6), handlerSegment: r.target, relocation: r};
  });
  if (records[0].message !== 0x201 || records[0].handlerOffset !== 0x243c || records[1].message !== 0x200 || records[1].handlerOffset !== 0x2330) throw Error('original menu map drift');
  const code = original.segment(4);
  const readHex = (start, length) => b.subarray(code.offset + start, code.offset + start + length).toString('hex');
  // These opcode checks make the stated coordinate/gate contract reviewable.
  if (readHex(0x2348, 6) !== '66268987e201' || readHex(0x2353, 7) !== '2681bfe2017c01' || readHex(0x240d, 5) !== '26899ce601') throw Error('original hover contract drift');
  return {originalSha256: original.sha256, records, hover: {handler: '4:2330', requiresObject1c6Nonzero: true, pointField: 0x1e2, selectionField: 0x1e6, minXInclusive: 380, installYExclusive: [135, 150], installSelection: 1, writesSelectionAt: '4:240d'}, down: {handler: '4:243c', gateFields: [0x1c6, 0x1e6], fallbackReturn: '4:24e8', installCall: '4:2488 -> 3:dad6'}, limitation: 'original static contract; runtime mapping, gate values and hover consumption require actual authenticated receipts'};
}
function analyzeReceipt(original, receipt) {
  const findings = [];
  for (const [rowIndex, row] of receipt.rows.entries()) {
    const owner = row.owner;
    const installReturns = new Map([[0x2002e,[0xdafc,0xdb2f]],[0x2003b,[0xdb0f]],[0x2002a,[0xdb23]],[0x2007c,[0xdb42]]]);
    if (row.kind === 'call' && installReturns.has(row.words[0]) && owner?.caller) {
      const returnOffset = row.words[1] - owner.csBase;
      const caller = original.authenticate(3, owner.caller.guest - owner.csBase, owner.caller.bytes);
      const action = owner.savedFrames?.find(f => f.returnOffset === 0x248d && f.code?.bytes);
      const savedCode = action && original.authenticate(4, action.code.guest - action.codeBase, action.code.bytes);
      const at = action ? 0x248b - (action.code.guest - action.codeBase) : -1;
      const targetSelector = at >= 0 && at + 2 <= action.code.bytes.length ? action.code.bytes[at] | action.code.bytes[at+1] << 8 : null;
      const relocation = original.segment(4).sites.get(0x248b);
      const sameObject = action && owner.savedFrames[0]?.objectOffsetCandidate === action.objectOffsetCandidate && owner.savedFrames[0]?.objectSelectorCandidate === action.objectSelectorCandidate && action.objectSelectorCandidate === owner.get_sreg_ss;
      const authenticated = row.phase === 'down' && installReturns.get(row.words[0]).includes(returnOffset) && caller.authenticated && savedCode?.authenticated && relocation?.target === 3 && relocation.type === 2 && targetSelector === owner.get_sreg_cs && sameObject;
      findings.push({rowIndex, boundary:'original Install 4:2488 -> 3:dad6 API', apiKey:row.words[0], returnOffset, authenticated:!!authenticated, caller, savedCode, targetSelector, sameObject:!!sameObject, limitation:'API-entry snapshot proves this boundary only; no internal5:32a4 return or installation completion'});
      continue;
    }
    if (row.kind !== 'call' || ![0x2007a,0x2007d].includes(row.words[0]) || !owner?.savedFrames) continue;
    if (row.words[0] === 0x2007d) {
      const caller = owner.caller && original.authenticate(4, owner.caller.guest - owner.csBase, owner.caller.bytes);
      const frame = owner.savedFrames[0], gates = frame?.objectGatesCandidate?.bytes;
      const authenticated = caller?.authenticated && row.words[1] - owner.csBase === 0x2427 && frame.objectSelectorCandidate === owner.get_sreg_ss && gates?.length === 36;
      const u = at => gates[at] | (gates[at+1] << 8);
      findings.push({rowIndex, boundary: 'original hover InvalidateRect after selection write', phase: row.phase, authenticated: !!authenticated, caller, selectorMapping: {selector: owner.get_sreg_cs, base: owner.csBase, originalSegment: authenticated ? 4 : null}, ...(authenticated ? {object: {selector: frame.objectSelectorCandidate, offset: frame.objectOffsetCandidate}, gate1c6: u(2), savedX: u(30), savedY: u(32), selection1e6: u(34)} : {})});
      continue;
    }
    const caller = owner.caller && original.authenticate(2, owner.caller.guest - owner.csBase, owner.caller.bytes);
    const wrapper = owner.savedFrames.find(f => f.returnOffset === 0x122f && f.returnSelector === owner.get_sreg_cs);
    const action = owner.savedFrames.find(f => f.returnOffset === 0x24e8 && f.code?.bytes);
    if (!caller?.authenticated || !wrapper || !action) { findings.push({rowIndex, authenticated: false, reason: 'expected owning caller and saved chain absent'}); continue; }
    const start = action.code.guest - action.codeBase;
    const check = original.authenticate(4, start, action.code.bytes);
    const relocation = original.segment(4).sites.get(0x24e6);
    const at = 0x24e6 - start;
    const selector = at >= 0 && at + 2 <= action.code.bytes.length ? action.code.bytes[at] | (action.code.bytes[at+1] << 8) : null;
    const sameObject = action.objectOffsetCandidate === wrapper.objectOffsetCandidate && action.objectSelectorCandidate === wrapper.objectSelectorCandidate && action.objectSelectorCandidate === owner.get_sreg_ss;
    const authenticated = check.authenticated && sameObject && relocation?.type === 2 && relocation.target === 2 && selector === owner.get_sreg_cs;
    const gates = action.objectGatesCandidate?.bytes;
    const u = at => gates[at] | (gates[at+1] << 8);
    findings.push({rowIndex, message: row.words[5], phase: row.phase, authenticated, caller, savedCode: check, selectorMapping: {selector: action.returnSelector, base: action.codeBase, originalSegment: authenticated ? 4 : null, relocatedCallSelector: selector, owningOriginalSegment2Selector: owner.get_sreg_cs}, sameObject, object: {selector: action.objectSelectorCandidate, offset: action.objectOffsetCandidate}, ...(authenticated && gates?.length === 36 ? {gate1c6: u(2), savedX: u(30), savedY: u(32), selection1e6: u(34)} : {})});
  }
  return {findings, limitation: 'snapshot at actual default API call after application handling; no callback RETF or pre-branch snapshot; absent saved DOWN chain on MOVE/UP does not imply missing delivery'};
}
if (require.main === module) { try {
  const original = image(fs.readFileSync(process.argv[2]));
  console.log(JSON.stringify(process.argv[3] ? analyzeReceipt(original, JSON.parse(fs.readFileSync(process.argv[3]))) : contract(original), null, 2));
} catch (e) { console.error(e); process.exitCode = 1; } }
module.exports = {image, contract, analyzeReceipt, ORIGINAL_SHA};
