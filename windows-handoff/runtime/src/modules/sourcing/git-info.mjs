import { execFileSync } from 'node:child_process';

export function getGitInfo({cwd=process.cwd()}={}){
  const run=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try{const commit=run(['rev-parse','HEAD']),branch=run(['branch','--show-current'])||'(detached)',status=run(['status','--porcelain']);return {available:true,branch,commit,status,statusClean:status===''};}
  catch(error){return {available:false,branch:null,commit:null,status:null,statusClean:false,error:String(error.message??error)};}
}
