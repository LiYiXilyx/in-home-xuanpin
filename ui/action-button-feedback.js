const activeFeedback=new WeakMap();

export function flashActionCheck(button,{durationMs=1200,schedule=setTimeout,cancel=clearTimeout}={}){
  const previous=activeFeedback.get(button);
  if(previous?.timer!==undefined)cancel(previous.timer);
  const originalLabel=previous?.originalLabel??button.textContent;
  const token={};
  button.textContent='✓';
  button.dataset.feedback='success';
  const timer=schedule(()=>{
    if(activeFeedback.get(button)?.token!==token)return;
    button.textContent=originalLabel;
    delete button.dataset.feedback;
    activeFeedback.delete(button);
  },durationMs);
  activeFeedback.set(button,{originalLabel,timer,token});
}
