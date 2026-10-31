'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'rootfs/etc/smartphoton_jkbms_multipack/www/scada/index.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'config.yaml'), 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(style && script, 'SCADA must retain its CSS and JS');
new vm.Script(script, { filename: 'scada/index.html inline script' });

assert.match(config, /version: 1\.0\.0-dev74\.2/);
assert.match(html, /const SCADA_UI='v0\.39'/);
const bms = html.slice(html.indexOf('function openBms(packId,bms){'), html.indexOf('function openBmsOverview(){'));
assert.match(bms, /class="detail-hero bms-operator-hero"/);
assert.match(bms, /class="detail-block bms-operator-block"/);
assert.match(bms, /function openBms\(packId,bms\)/);
assert.match(html, /function openPack\(id\)/);
assert.match(html, /function openBmsControls\(packId,bms\)/);
assert.match(html, /function openBmsTechnicalParameters\(packId,bms\)/);

const responsive = style.slice(style.indexOf('DEV74.2 — SCADA responsive'));
assert(responsive.length > 6000, 'Missing responsive stylesheet');
for (const selector of [
  '.bms-operator-block .bms-live-grid',
  '.bms-operator-block .bms-live-tile span',
  '.bms-operator-block .inline-action',
  '.detail-body:has(.bms-operator-block)',
  '.source,.load{display:block',
  'grid-template-areas:"source load" "bus bus"',
  'grid-template-areas:"source" "bus" "load"',
  '.sidebar{grid-column:1;grid-row:2',
  '.scada-overlay{padding:0}',
  '.control-confirm-card{max-height:',
]) assert(responsive.includes(selector), 'Responsive rule missing: '+selector);
for (const width of [1500,1050,800,600,390]) {
  assert(responsive.includes('@media(max-width:'+width+'px)'), 'Missing breakpoint '+width);
}
assert(!responsive.includes('display:none}.source,.load'), 'Responsive must not hide source/load');
assert(!responsive.includes('transform:scale('), 'Do not shrink the entire SCADA to fit');
const screenshotFix = responsive.slice(responsive.indexOf('DEV74.2 screenshot follow-up'));
assert(screenshotFix.length > 2500, 'Missing screenshot-based fixes');
for (const expected of [
  '.main>.process{grid-column:1;grid-row:3',
  '.main>.rail{grid-column:1;grid-row:4',
  '.main>.bottom{grid-column:1;grid-row:5',
  '.process>.synoptic{',
  '.process>.synoptic>.source{grid-area:source;display:block',
  '.process>.synoptic>.load{grid-area:load;display:block',
  '.process>.synoptic>.centerbus{grid-area:bus',
  '.packname{max-width:100%;white-space:normal',
  '.rail .kpi{min-height:104px;overflow:visible}',
  '.control-card .control-desc{font-size:12px',
]) assert(screenshotFix.includes(expected), 'Missing screenshot fix: '+expected);

// Regression for 1100px and 600px screenshots: five auto rows shrink
// inside the fixed-height app and paint the process over later panels.
const trackFix = responsive.slice(responsive.indexOf('DEV74.2 narrow viewport track sizing fix'));
assert(trackFix.length > 600, 'Missing narrow viewport track sizing fix');
for (const expected of [
  'grid-template-rows:repeat(5,max-content)',
  'grid-auto-rows:max-content',
  'overflow-y:auto',
  '.main>.process{height:max-content;overflow:visible}',
  '.main>.rail{height:max-content;overflow:visible}',
]) assert(trackFix.includes(expected), 'Missing non-overlapping narrow viewport track rule: '+expected);

// Check CSS block balance, ignoring comments and quoted content.
let depth=0,quote='',comment=false;
for(let i=0;i<style.length;i++){
  const c=style[i],n=style[i+1];
  if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}
  if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}
  if(c==='/'&&n==='*'){comment=true;i++;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='{')depth++;
  if(c==='}'){depth--;assert(depth>=0,'Extra CSS closing brace');}
}
assert.equal(depth,0,'CSS block not closed');
console.log('PASS: DEV74.2 SCADA responsive CSS, BMS readability, HTML JS syntax, and safe viewport breakpoints');
