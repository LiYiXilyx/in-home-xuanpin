import { AppError } from '../../shared/errors.mjs';

export function createInitialActivationCoordinator() {
  const held=new Set();
  return {isActivating:id=>held.has(String(id)),run(id,work){const key=String(id);
    if(held.has(key))throw new AppError('首池正在建立。',{code:'INITIAL_POOL_ACTIVATION_IN_PROGRESS',retriable:true});
    held.add(key);try{return work();}finally{held.delete(key);}}};
}
