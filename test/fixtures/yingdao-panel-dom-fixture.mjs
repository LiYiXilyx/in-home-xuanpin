export class FakeElement {
  constructor(tagName='div',id=''){this.tagName=tagName.toUpperCase();this.id=id;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.href='';this.title='';this.children=[];this.listeners=new Map();this.attributes=new Map();}
  addEventListener(type,listener){const rows=this.listeners.get(type)??[];rows.push(listener);this.listeners.set(type,rows);}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);if(name==='href')this.href='';}
  replaceChildren(...children){this.children=children;}
  append(...children){this.children.push(...children);}
  async emit(type,properties={}){const event={type,target:this,preventDefault(){},...properties};for(const listener of this.listeners.get(type)??[])await listener(event);}
}

export class FakeRoot extends FakeElement {
  constructor(){super('section','yingdao-module-root');this.elements=new Map();this._innerHTML='';this.ownerDocument={
    createElement:tag=>new FakeElement(tag),defaultView:{CustomEvent:class {constructor(type,{detail,bubbles}={}){this.type=type;this.detail=detail;this.bubbles=bubbles;}}}
  };this.events=[];}
  set innerHTML(value){this._innerHTML=String(value);this.elements.clear();for(const match of this._innerHTML.matchAll(/<([a-z0-9-]+)[^>]*\bid="([^"]+)"[^>]*>/gi)){const element=new FakeElement(match[1],match[2]);this.elements.set(element.id,element);}}
  get innerHTML(){return this._innerHTML;}
  querySelector(selector){return selector.startsWith('#')?this.elements.get(selector.slice(1))??null:null;}
  replaceChildren(){this._innerHTML='';this.elements.clear();}
  dispatchEvent(event){this.events.push(event);return true;}
}

export function yingdaoDomFixture(){const yingdaoRoot=new FakeRoot(),timers=new Map();let sequence=0;const scheduler={
  setInterval(fn,delay){const id=++sequence;timers.set(id,{fn,delay});return id;},clearInterval(id){timers.delete(id);}
};return{yingdaoRoot,scheduler,timers,byId:id=>yingdaoRoot.querySelector(`#${id}`)};}
