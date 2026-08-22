export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}

export function percentile(values,percent) {
  const numbers=values.map(finiteNumber).filter(value => value !== null).sort((a,b) => a-b);
  if (numbers.length === 0) return null;
  const bounded=Math.min(1,Math.max(0,Number(percent)));
  const position=(numbers.length-1)*bounded;
  const lower=Math.floor(position);
  const upper=Math.ceil(position);
  if (lower === upper) return numbers[lower];
  return numbers[lower]+(numbers[upper]-numbers[lower])*(position-lower);
}

export function median(values) { return percentile(values,0.5); }

export function summarizeNumbers(values) {
  const numbers=values.map(finiteNumber).filter(value => value !== null);
  const total=numbers.reduce((sum,value) => sum+value,0);
  return {
    count:numbers.length,
    total:numbers.length ? total : null,
    min:numbers.length ? Math.min(...numbers) : null,
    max:numbers.length ? Math.max(...numbers) : null,
    avg:numbers.length ? total/numbers.length : null,
    median:median(numbers),
    p25:percentile(numbers,0.25),
    p75:percentile(numbers,0.75),
    p90:percentile(numbers,0.9)
  };
}

export function topSalesShare(values,limit) {
  const numbers=values.map(finiteNumber).filter(value => value !== null && value >= 0).sort((a,b) => b-a);
  const total=numbers.reduce((sum,value) => sum+value,0);
  if (numbers.length === 0 || total <= 0) return 0;
  return numbers.slice(0,Math.max(0,Number(limit) || 0)).reduce((sum,value) => sum+value,0)/total;
}

export function ratioAtLeast(values,threshold) {
  const numbers=values.map(finiteNumber).filter(value => value !== null);
  if (numbers.length === 0) return null;
  return numbers.filter(value => value >= threshold).length/numbers.length;
}

export function safeRound(value,digits=4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor=10**digits;
  return Math.round(Number(value)*factor)/factor;
}

export function assertFiniteTree(value,path='value') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} 包含 NaN/Infinity。`);
  if (Array.isArray(value)) value.forEach((item,index) => assertFiniteTree(item,`${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key,item] of Object.entries(value)) assertFiniteTree(item,`${path}.${key}`);
  }
}
