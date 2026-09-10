import { fineClassificationInput,hashFineClassificationInput } from './fine-classification-input.mjs';

export function buildFineClassificationPrompt(product,taxonomy) {
  const input=fineClassificationInput(product);
  const choices=taxonomy.categories.map(item => ({ level2:item.level2,level3:item.level3 }));
  const system=[
    '你是摩托车配件结构化分类器。只能从给定 taxonomy 中选择 level2/level3。',
    '只返回一个 JSON 对象，不要返回 Markdown。无法高置信度判断时必须降低 confidence 并说明原因。',
    '必须包含：level2, level3, product_family, is_electronic, has_usb, battery_risk, certification_risk, confidence, reason。',
    `taxonomy=${JSON.stringify(choices)}`
  ].join('\n');
  return { system,user:JSON.stringify(input),input,inputHash:hashFineClassificationInput(input),promptVersion:taxonomy.promptVersion };
}
