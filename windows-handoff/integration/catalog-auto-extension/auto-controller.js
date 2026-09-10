'use strict';
class CatalogAutoController{
 constructor(d){this.d=d;this.state='idle';this.screens=0;this.added=0;}
 now(){return this.d.now?.()??Date.now();}
 pause(){if(this.state==='running')this.state='paused';}
 resume(){if(this.state==='paused'){this.state='running';this.reason='';}}
 stop(){if(['running','paused'].includes(this.state))this.state='stopping';}
 async checkpoint(){
 while(this.state==='paused'&&this.now()<this.deadline){this.d.update(this);await this.d.wait(200);}
 if(this.state==='stopping'){this.reason='已停止';return false;}
 if(this.now()>=this.deadline){this.reason='达到最长运行时间';return false;}return true;
 }
 async run({target=300,maxMinutes=30,intervalSeconds=6}={}){
 if(['running','paused','stopping'].includes(this.state))throw Error('任务已经运行');
 if(!Number.isInteger(target)||target<0||!Number.isFinite(maxMinutes)||maxMinutes<1||maxMinutes>240||!Number.isFinite(intervalSeconds)||intervalSeconds<5||intervalSeconds>60)throw Error('新增目标填非负整数（0仅按时间停止）；运行1–240分钟；间隔5–60秒');
 this.state='running';this.screens=0;this.added=0;this.reason='';this.startedAt=this.now();this.deadline=this.startedAt+maxMinutes*60000;
 try{let stalled=0;const origin=await this.d.count();while(await this.checkpoint()){
 await this.d.guard();if(!await this.checkpoint())break;
 await this.d.capture();this.screens++;this.added=Math.max(0,(await this.d.count())-origin);this.d.update(this);
 if(target>0&&this.added>=target){this.reason='达到新增目标';break;}
 if(!await this.checkpoint())break;
 if(this.d.seeMore?.()){await this.d.guard();if(!await this.checkpoint())break;this.reason='正在加载更多商品';this.d.update(this);await this.d.loadMore(this);this.reason='';}
 if(!await this.checkpoint())break;await this.d.guard();if(!await this.checkpoint())break;
 const before=this.d.position();await this.d.scroll();
 for(let t=0;t<intervalSeconds*1000;t+=250){if(!await this.checkpoint())break;await this.d.wait(250);}
 if(!await this.checkpoint())break;const after=this.d.position();stalled=Math.abs(after-before)<2?stalled+1:0;
 if(stalled>=3){this.reason='页面连续三次无法继续滚动，请检查加载状态';break;}
 }this.state='done';}catch(e){this.reason=e.message;this.state='error';}finally{this.d.update(this);}
 }
}
globalThis.CatalogAutoController=CatalogAutoController;
