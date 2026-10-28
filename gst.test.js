// GST helpers from assets/app.js (browser file, so the functions are lifted out of the source text). Run: node tests/gst.test.js
const src=require('fs').readFileSync(__dirname+'/../assets/app.js','utf8');let n=0,f=0;
const eq=(k,a,b)=>{n++;if(JSON.stringify(a)!==JSON.stringify(b)){f++;console.log('FAIL',k,JSON.stringify(a),'!=',JSON.stringify(b))}};
const pick=name=>{const m=src.match(new RegExp('^const '+name+'=.*$','m'));if(!m)throw new Error('missing '+name);return m[0].replace(/^const /,'var ')};
eval(['paise','RATES','GSTIN_CH','gstinOk','stCode','isInter','gst'].map(pick).join(';\n'));
const MH={state:'Maharashtra'},KA={state:'Karnataka'};
eq('rates include 40 and 3',RATES.includes(40)&&RATES.includes(3),true);
eq('intra-state 18% on 1000',gst(1000,18,MH,MH),{cgst:90,sgst:90,igst:0});
eq('inter-state 18% on 1000',gst(1000,18,MH,KA),{cgst:0,sgst:0,igst:180});
eq('CGST equals SGST on odd paise (100.10 @5%)',gst(100.10,5,MH,MH),{cgst:2.5,sgst:2.5,igst:0});
for(const [tv,r] of [[0.01,5],[33.33,12],[999.99,28],[1234.56,18],[0.5,3],[7777.77,40],[100.10,5],[19.99,18]]){const g=gst(tv,r,MH,MH);eq('CGST=SGST '+tv+'@'+r,g.cgst===g.sgst,true)}
eq('inter-state rounds half up',gst(100.10,5,MH,KA).igst,5.01);
eq('zero rate',gst(500,0,MH,MH),{cgst:0,sgst:0,igst:0});
eq('valid GSTIN',gstinOk('27AAPFU0939F1ZV'),true);eq('lower case accepted',gstinOk('27aapfu0939f1zv'),true);
eq('wrong check digit',gstinOk('27AAPFU0939F1ZX'),false);eq('too short',gstinOk('27AAPFU0939F1Z'),false);eq('blank',gstinOk(''),false);eq('wrong shape',gstinOk('ABCDEFGHIJKLMNO'),false);
eq('state code from GSTIN',stCode('27AAPFU0939F1ZV'),'27');eq('no state code from junk',stCode('xx'),null);
eq('GSTIN state codes decide inter-state',isInter({gstin:'27AAPFU0939F1ZV',state:'Karnataka'},{gstin:'29AAPFU0939F1ZV'}),true);
eq('same GSTIN state = intra even if names differ',isInter({gstin:'27AAPFU0939F1ZV',state:'Maharashtra'},{gstin:'27AAPFU0939F1ZV',state:'Karnataka'}),false);
eq('falls back to state names without GSTIN',isInter(MH,KA),true);eq('no state info = intra (as before)',isInter({},{}),false);
console.log(f?f+' FAILED of '+n:'gst: all '+n+' tests passed');process.exit(f?1:0);
