class FakeElement {
  constructor(tagName='div',id=''){
    this.tagName=tagName.toUpperCase();this.id=id;this.value='';this.textContent='';this.hidden=false;
    this.disabled=false;this.required=false;this.children=[];this.listeners=new Map();
  }
  addEventListener(type,listener){const rows=this.listeners.get(type)??[];rows.push(listener);this.listeners.set(type,rows);}
  replaceChildren(...children){this.children=children;if(this.tagName==='SELECT')this.value=children.find(row=>!row.disabled)?.value??'';}
  append(...children){this.children.push(...children);}
  async emit(type,properties={}){const event={type,target:this,preventDefault(){this.defaultPrevented=true;},...properties};
    for(const listener of this.listeners.get(type)??[])await listener(event);return event;}
}

class FakeRoot extends FakeElement {
  constructor({customEventAvailable=true}={}){super('section','catalog-module-root');this.elements=new Map();this.events=[];this._innerHTML='';
    const fixture=this;
    this.ownerDocument={createElement(tagName){return new FakeElement(tagName);},defaultView:{
      CustomEvent:customEventAvailable?class {constructor(type,options={}){this.type=type;this.detail=options.detail;this.bubbles=options.bubbles;}}:undefined
    }};
    this.dispatchEvent=event=>{fixture.events.push(event);return true;};
  }
  set innerHTML(value){this._innerHTML=String(value);this.elements.clear();
    for(const match of this._innerHTML.matchAll(/<([a-z0-9-]+)[^>]*\bid="([^"]+)"[^>]*>/gi)){
      const element=new FakeElement(match[1],match[2]),tag=match[0];
      element.hidden=/\shidden(?:\s|>|=)/.test(tag);element.disabled=/\sdisabled(?:\s|>|=)/.test(tag);
      element.required=/\srequired(?:\s|>|=)/.test(tag);const value=tag.match(/\bvalue="([^"]*)"/);if(value)element.value=value[1];
      this.elements.set(element.id,element);
    }}
  get innerHTML(){return this._innerHTML;}
  get textContent(){return [...this.elements.values()].map(element=>element.textContent).join(' ');}
  set textContent(_value){}
  querySelector(selector){if(!selector.startsWith('#'))return null;return this.elements.get(selector.slice(1))??null;}
  replaceChildren(){this._innerHTML='';this.elements.clear();}
}

export function catalogDomFixture(options={}){
  const catalogRoot=new FakeRoot(options),yingdao={marker:'untouched',controls:{disabled:false}},timers=new Map();let nextTimer=1;
  const scheduler={setInterval(callback,ms){const id=nextTimer++;timers.set(id,{callback,ms});return id;},clearInterval(id){timers.delete(id);}};
  return{catalogRoot,yingdao,scheduler,byId:id=>catalogRoot.querySelector(`#${id}`),events:catalogRoot.events,timers};
}
