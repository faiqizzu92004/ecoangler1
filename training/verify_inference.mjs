import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { predictProductivity, calendarFeatures } from './inference.mjs';

const directory = process.argv[2] || fileURLToPath(new URL('.', import.meta.url));
const model = JSON.parse(readFileSync(resolve(directory, 'website_model.json'), 'utf8'));
const cases = JSON.parse(readFileSync(resolve(directory, 'verification_cases.json'), 'utf8'));
const start = performance.now();
const errors = { 'Random Forest': 0, XGBoost: 0, Ensemble: 0 };
for (const [index, item] of cases.entries()) {
  const actual = predictProductivity(model, item.input);
  const groups = {
    'Random Forest': actual.members.randomForest.probabilities,
    XGBoost: actual.members.xgboost.probabilities,
    Ensemble: actual.probabilities,
  };
  for (const [name, probabilities] of Object.entries(groups)) {
    for (let k = 0; k < 3; k += 1) {
      const error = Math.abs(probabilities[model.metadata.classes[k]] - item.expected[name][k]);
      errors[name] = Math.max(errors[name], error);
      assert.ok(error < 1e-6, `Probability mismatch at case ${index}, ${name}, class ${k}: ${error}`);
    }
    const expectedClass = item.expected[name].indexOf(Math.max(...item.expected[name]));
    const actualClass = Object.values(probabilities).indexOf(Math.max(...Object.values(probabilities)));
    assert.equal(actualClass, expectedClass, `Class mismatch at case ${index}, ${name}`);
  }
}
assert.deepEqual(calendarFeatures('2026-10-17'), { month: 10, weekday: 6, isWeekend: 1 });
assert.deepEqual(calendarFeatures('2026-10-19'), { month: 10, weekday: 1, isWeekend: 0 });
assert.throws(() => calendarFeatures('2026-02-30'));
assert.throws(() => calendarFeatures('not-a-date'));
const valid = cases[0].input;
for (const field of model.metadata.features) {
  const invalid = { ...valid, [field]: null };
  assert.throws(() => predictProductivity(model, invalid));
}
assert.throws(() => predictProductivity(model, { ...valid, windSpeed: -1 }));
assert.throws(() => predictProductivity(model, { ...valid, pressure: Infinity }));
assert.throws(() => predictProductivity(model, { ...valid, isWeekend: 1-valid.isWeekend }));
const result = { passed: true, cases: cases.length, probabilityTolerance: 1e-6,
  maxAbsoluteError: errors, classPredictionsIdentical: true,
  elapsedMilliseconds: performance.now()-start, includesInvalidInputChecks: true };
writeFileSync(resolve(directory,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
