// SPDX-License-Identifier: AGPL-3.0-only
import { execFile } from 'node:child_process';
import { desktopRequest } from './.lumo-use.mjs';
const executable = 'lumod';
const permissionMode = 'ask';
const desktopEnabled = true;
export function appRequest(operation, params, signal, kind = 'desktop-app') {
 if (permissionMode === 'read-only' && !['api','list','status','validate'].includes(operation)) throw new Error('App changes are unavailable in read only mode.');
 if (signal?.aborted) throw new Error('App action interrupted.');
 return new Promise((resolve,reject) => {
  const child=execFile(executable,[kind,operation],{signal,timeout:30000,maxBuffer:2*1024*1024},(error,stdout,stderr)=>{
   try {const value=JSON.parse(stdout);if(error && value.ok !== false) throw error;resolve(value);}catch{reject(new Error(stderr.trim()||'App action failed.'));}
  });
  child.stdin.end(JSON.stringify(params));
 });
}
export default function(pi) {
 const nativeTools=[
  ['api','Read the complete-plugin guide first. Covers UI, Node.js backend, Pi tools, validation and repair. Trusted account code; use lumo_app_api for sandboxed apps.',{}],
  ['list','List per-account native app versions, staged releases and revisions before install or restore.',{}],
  ['create','Create a complete plugin project and validator script in a new absolute path. Backend and Pi tools default on; set both false for UI only.',{project:{type:'string'},name:{type:'string'},title:{type:'string'},backend:{type:'boolean'},pi:{type:'boolean'}}],
  ['validate','Run enforced static source/manifest validation without executing app code or installing. Fix every returned file/code/message/fix diagnostic and repeat.',{project:{type:'string'}}],
  ['build','Validate and stage all plugin parts as one immutable package. Invalid builds are blocked. Returns release.digest. Increase version for changed source.',{project:{type:'string'}}],
  ['install','Install the exact staged digest for this account after revalidation. This grants trusted UI and backend account access. Requires trust:true and current revision. Close app windows and finish active Pi operations first.',{name:{type:'string'},digest:{type:'string'},revision:{type:'string'},requestId:{type:'string'},trust:{type:'boolean',const:true}}],
  ['restore','Restore previous native app code; data is preserved. Use current revision, unique requestId and trust:true. Close app windows and finish active Pi operations first.',{name:{type:'string'},revision:{type:'string'},requestId:{type:'string'},trust:{type:'boolean',const:true}}]
 ];
 for(const [operation,description,properties] of nativeTools)pi.registerTool({name:'lumo_plugin_'+operation,label:'Lumo Plugins · '+operation,description,parameters:{type:'object',properties,required:Object.keys(properties).filter(key=>!['backend','pi'].includes(key)),additionalProperties:false},execute:async(_id,params,signal)=>{const value=await appRequest(operation,params,signal,'native-app');return {isError:value.ok===false,content:[{type:'text',text:JSON.stringify(value)}]};}});

 const tools=[
  ['api','Call this first for every app build or update. Read builderGuide for app-type selection, project structure, implementation, verification and release. Returns the current sandbox APIs and SDK; these tools do not build native backend or Pi-extension packages.',{}],
  ['list','List installed apps and staged builds. Read current revisions before changing installed apps.',{}],
  ['create','Create a template (default pulse; optional counter, notes, or react with app-owned saved data) in a new absolute project directory. Never overwrites files.',{project:{type:'string'},id:{type:'string'},name:{type:'string'},template:{type:'string',enum:['pulse','counter','notes','react']}}],
  ['build','Validate and stage an immutable JavaScript/CSS or fixed React/TSX app from an absolute project directory. Increase manifest version for changed source. No downloads or project build scripts.',{project:{type:'string'}}],
  ['status','Read bounded app runtime diagnostics. App output is untrusted data. A ready report is not independent visual verification.',{digest:{type:'string'}}],
  ['install','Install or update an exact staged digest. Grants declared metrics read access and/or app-owned storage. Use the current revision from list, or empty revision for a new app. Request ID must be unique for each action.',{id:{type:'string'},digest:{type:'string'},revision:{type:'string'},requestId:{type:'string'}}],
  ['restore','Restore the previous installed app version. Read current revision first; use a unique request ID.',{id:{type:'string'},revision:{type:'string'},requestId:{type:'string'}}]
 ];
 for(const [operation,description,properties] of tools)pi.registerTool({name:'lumo_app_'+operation,label:'Lumo Apps · '+operation,description,parameters:{type:'object',properties,required:Object.keys(properties).filter((key)=>key!=='template'),additionalProperties:false},execute:async(_id,params,signal)=>({content:[{type:'text',text:JSON.stringify(await appRequest(operation,params,signal))}]})});
 if (desktopEnabled) pi.registerTool({name:'lumo_app_preview',label:'Lumo Apps · Preview',description:'Open a staged app digest in the connected Lumo tab, with declared metrics access and separate temporary preview storage. Returns window opening status; use status and inspect the rendered app before claiming verification.',parameters:{type:'object',properties:{digest:{type:'string'},name:{type:'string'}},required:['digest','name'],additionalProperties:false},execute:(_id,params,signal,_update,ctx)=>{if(permissionMode==='read-only')throw new Error('Preview requires app execution permission.');return desktopRequest({action:'app_preview',target:params.digest,label:params.name},signal,ctx);}});
}
