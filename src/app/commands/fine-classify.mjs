import { runFineClassification } from '../../modules/products/fine-classification-service.mjs';

export async function runFineClassifyCommand(config,options={}) { return runFineClassification(config,options); }
