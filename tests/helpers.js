import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export const project = fileURLToPath(new URL('../', import.meta.url));
export const cli = args => execFileSync('python3', [join(project, 'bin/navocode.py'), ...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
const git = (repo,args) => execFileSync('git',['-C',repo,...args],{encoding:'utf8'});
export function jsonWrite(path,value) { mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(value,null,2));renameSync(path+'.tmp',path); }
export function fixture(t) {
  const repo=mkdtempSync(join(tmpdir(),'navocode-browser-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));git(repo,['init','-q']);git(repo,['config','user.name','NavoCode tests']);git(repo,['config','user.email','test@navocode.local']);
  writeFileSync(join(repo,'billing.js'),'export const payer = account => account.owner;\n');git(repo,['add','.']);git(repo,['commit','-qm','Baseline']);const base=git(repo,['rev-parse','HEAD']).trim();writeFileSync(join(repo,'billing.js'),'export const payer = account => account.billingOwner ?? account.owner;\n');
  const spec=JSON.parse(readFileSync(join(project,'examples/billing.json'),'utf8'));spec.baseRef=base;spec.sourceDigest=JSON.parse(cli(['context','--repo',repo])).sourceDigest;spec.groups[0].paths=['billing.js'];spec.unknowns=[];spec.components.forEach(c=>c.observed=c.intended);spec.decisions.forEach(d=>{d.status='accepted';d.provenance='human';});spec.evidence=[{id:'source-check',claim:'Delegation preserves fallback.',kind:'source',status:'supported',detail:'Fixture source inspection.',paths:['billing.js'],sourceDigest:spec.sourceDigest}];
  const path=join(repo,'.navocode/changes/delegated-billing/spec.json');jsonWrite(path,spec);return {repo,base,spec,path};
}
export async function startServer({specPath,repo,mode='author',sessionPath,baselinePath,agent='manual',agentCommand,agentSession}) {
  const args=['start','--spec',specPath,'--repo',repo,'--mode',mode,'--session',sessionPath,'--agent',agent];if(baselinePath)args.push('--baseline',baselinePath);if(agentSession)args.push('--agent-session',agentSession);if(agentCommand)args.push('--agent-command',JSON.stringify(agentCommand));cli(args);
  const session=JSON.parse(readFileSync(sessionPath,'utf8'));
  return {session,server:{closeAllConnections(){},close(){try{cli(['stop','--session',sessionPath,'--agent',agent]);}catch{}}}};
}
export async function sessionRequest(path,route,body) {
  const session=JSON.parse(readFileSync(path,'utf8'));
  const response=await fetch(session.origin+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
