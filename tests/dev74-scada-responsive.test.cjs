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

// DEV74.2 follow-up: the status/demo footer must scroll with the dashboard,
// not obscure the last row of packs or operator journal.
const footer = '<div class="demo"><span id="dataMode">';
const footerIndex = html.indexOf(footer);
assert(footerIndex > 0, 'SCADA footer missing');
assert(footerIndex < html.indexOf('</main>'), 'Footer must be inside scrolling main');
assert.equal(html.indexOf(footer, footerIndex + 1), -1, 'Footer duplicated');
const footerFix = responsive.slice(responsive.indexOf('DEV74.2 operator follow-up'));
assert(footerFix.length > 800, 'Missing footer and mobile operator follow-up');
for (const expected of [
  '.main>.demo{',
  'position:relative;inset:auto;grid-column:1/-1;grid-row:auto',
  '.main>.demo{grid-column:1;grid-row:6',
  '.detail-body .detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}',
  '.detail-body .bms-cards{grid-template-columns:minmax(0,1fr)}',
  '.control-action-btn{min-height:40px}',
  '.detail-body .detail-grid{grid-template-columns:minmax(0,1fr)}',
]) assert(footerFix.includes(expected), 'Missing footer/mobile rule: ' + expected);

// Narrow 360px/480px screenshots: changing from Pack to BMS to Conduite
// reused an old scroll offset and made content show through a translucent title.
const modalBlock=html.slice(html.indexOf('function showScadaDetail('),html.indexOf('function openPack('));
assert.match(modalBlock,/function showScadaDetail\(preserveScroll=false\)/);
assert.match(modalBlock,/panel\.scrollTop=preserveScroll\?previous:0/);
const controlsBlock=html.slice(html.indexOf('function openBmsControls('),html.indexOf('const BMS_PARAMETER_SECTIONS='));
assert.match(controlsBlock,/showScadaDetail\(preserveScroll\)/);
assert.match(controlsBlock,/openBmsControls\(packId,bms,true\)/);
assert.match(controlsBlock,/panel\.scrollTop=at/);
const parameterBlock=html.slice(html.indexOf('function openBmsTechnicalParameters('),html.indexOf('function findParameterDef('));
assert.match(parameterBlock,/showScadaDetail\(preserveScroll\)/);
assert.match(parameterBlock,/openBmsTechnicalParameters\(packId,bms,true\)/);
const screenBlock=html.slice(html.indexOf('function openBms(packId,bms){'),html.indexOf('function openBmsOverview(){'));
assert.match(screenBlock,/showScadaDetail\(\)/);
const packBlock=html.slice(html.indexOf('function openPack(id){'),html.indexOf('function boolState('));
assert.match(packBlock,/showScadaDetail\(\)/);
const headerFix=style.slice(style.indexOf('DEV74.2: mobile operator sheet header'));
assert.match(headerFix,/\.detail-panel>\.detail-head\s*\{\s*background:#091e29/);
assert.match(headerFix,/background:#091e29;min-height:70px/);
assert(!headerFix.includes('backdrop-filter:blur'), 'Sticky header must remain opaque');

// Desktop Home Assistant 1537px screenshot: the rail must set the row
// height so the last status panel never overlaps the Trend panel.
const desktopFix=style.slice(style.indexOf('DEV74.2 desktop HA iframe fix'));
assert(desktopFix.length>500, 'Missing desktop rail height fix');
for(const expected of [
  '@media(min-width:1501px)',
  'grid-template-rows:max-content max-content max-content minmax(218px,max-content) max-content',
  '.main>.rail .kpi{flex:0 0 auto;min-height:104px}',
  '.main>.rail .alarmbox{flex:0 0 auto;min-height:92px}',
  '.main>.bottom{grid-row:4;min-height:218px}',
  '.main>.demo{grid-row:5}'
]) assert(desktopFix.includes(expected),'Missing desktop rail layout rule: '+expected);

// Visual follow-up: compact the naturally sized desktop Installation rail so
// the process canvas is not mostly empty, without returning to fixed heights.
const desktopDensity=style.slice(style.indexOf('DEV74.2 desktop density follow-up'));
assert(desktopDensity.length>450, 'Missing desktop Installation density follow-up');
for(const expected of [
  '@media(min-width:1501px)',
  '.main>.rail{padding:12px;gap:8px}',
  '.main>.rail .kpi{min-height:0;flex:0 0 auto;padding:9px 11px}',
  '.main>.rail .alarmbox{min-height:0;flex:0 0 auto;padding:10px}',
  '.main>.process .synoptic{top:78px;bottom:15px}',
]) assert(desktopDensity.includes(expected),'Missing desktop density rule: '+expected);

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
