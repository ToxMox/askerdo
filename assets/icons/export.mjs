import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const sharp=process.env.ICON_NODE_MODULES?require(path.join(process.env.ICON_NODE_MODULES,'sharp')):require('sharp');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));

async function rgba(source,size){
  const svg=await fs.readFile(path.join(root,source));
  return sharp(svg,{density:72}).resize(size,size).toColourspace('srgb').ensureAlpha().raw().toBuffer();
}

function dib(pixels,size){
  const maskStride=Math.ceil(size/32)*4;
  const pixelBytes=size*size*4;
  const out=Buffer.alloc(40+pixelBytes+maskStride*size);
  out.writeUInt32LE(40,0);
  out.writeInt32LE(size,4);
  out.writeInt32LE(size*2,8);
  out.writeUInt16LE(1,12);
  out.writeUInt16LE(32,14);
  out.writeUInt32LE(0,16);
  out.writeUInt32LE(pixelBytes+maskStride*size,20);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const src=(y*size+x)*4,dst=40+((size-1-y)*size+x)*4;
    const alpha=pixels[src+3];
    // Classic BI_RGB icon pixels: bottom-up, straight BGRA with 8-bit alpha.
    out[dst]=alpha?pixels[src+2]:0;
    out[dst+1]=alpha?pixels[src+1]:0;
    out[dst+2]=alpha?pixels[src]:0;
    out[dst+3]=alpha;
    // The legacy AND mask is DWORD aligned and uses 1 for transparent pixels.
    if(alpha===0)out[40+pixelBytes+(size-1-y)*maskStride+(x>>3)]|=0x80>>(x&7);
  }
  return out;
}

for(const item of manifest.exports){
  if(item.type==='png'){
    const pixels=await rgba(item.source,item.size);
    await sharp(pixels,{raw:{width:item.size,height:item.size,channels:4}}).png({compressionLevel:9}).toFile(path.join(root,item.file));
    continue;
  }
  const frames=[];
  for(const frame of item.frames){
    const pixels=await rgba(frame.source,frame.size);
    const bytes=frame.encoding==='png'?await sharp(pixels,{raw:{width:frame.size,height:frame.size,channels:4}}).png({compressionLevel:9}).toBuffer():dib(pixels,frame.size);
    frames.push({...frame,bytes});
  }
  const directory=Buffer.alloc(6+16*frames.length);
  directory.writeUInt16LE(1,2);directory.writeUInt16LE(frames.length,4);
  let offset=directory.length;
  frames.forEach((frame,i)=>{
    const e=6+16*i;
    directory[e]=frame.size===256?0:frame.size;directory[e+1]=directory[e];
    directory.writeUInt16LE(1,e+4);directory.writeUInt16LE(32,e+6);
    directory.writeUInt32LE(frame.bytes.length,e+8);directory.writeUInt32LE(offset,e+12);
    offset+=frame.bytes.length;
  });
  await fs.writeFile(path.join(root,item.file),Buffer.concat([directory,...frames.map(f=>f.bytes)]));
}
console.log(`Exported ${manifest.exports.length} raster assets from SVG sources.`);
