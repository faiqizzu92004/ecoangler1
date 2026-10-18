/** Exact numeric-tree inference for the exported EcoAngler RF/XGBoost model.
 * No Python service, package downloads, inference API key, or catch history.
 * RF averages per-leaf class proportions. XGBoost adds one margin per class,
 * follows strict-less-than branches, then applies softmax. Equal probability
 * averaging produces the ensemble output. float32 operations match predictors.
 */
export function validateFeatures(model, record) {
  if (model?.formatVersion !== 1) throw new Error('Unsupported EcoAngler model format.');
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Weather inputs must be an object.');
  }
  const values = model.metadata.features.map((name) => {
    const value = record[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`A valid ${name} value is required for prediction.`);
    }
    return Math.fround(value);
  });
  for (const [name, low, high, integer] of [
    ['airTemp', -100, 70, false], ['windSpeed', 0, 500, false],
    ['pressure', 300, 1200, false], ['month', 1, 12, true],
    ['weekday', 1, 7, true], ['isWeekend', 0, 1, true],
  ]) {
    const value = record[name];
    if (value < low || value > high || (integer && !Number.isInteger(value))) {
      throw new Error(`The ${name} input is outside its valid range.`);
    }
  }
  if (record.isWeekend !== Number(record.weekday >= 6)) {
    throw new Error('The weekday and weekend flag disagree.');
  }
  return values;
}

function rfProbabilities(forest, values) {
  const totals = [0, 0, 0];
  for (const nodes of forest.trees) {
    let node = nodes[0];
    while (node.length === 4) {
      node = nodes[values[node[0]] <= node[1] ? node[2] : node[3]];
    }
    for (let k = 0; k < 3; k += 1) totals[k] += node[k];
  }
  return totals.map((total) => total / forest.trees.length);
}

function xgboostProbabilities(boost, values) {
  const margins = boost.baseMargins.map(Math.fround);
  for (const tree of boost.trees) {
    let node = tree.nodes[0];
    while (node.length === 4) {
      node = tree.nodes[values[node[0]] < Math.fround(node[1]) ? node[2] : node[3]];
    }
    margins[tree.classIndex] = Math.fround(margins[tree.classIndex] + Math.fround(node[0]));
  }
  const maximum = Math.max(...margins);
  // Float64 exp and normalization differ only at float32 rounding scale from
  // the native XGBoost CPU softmax; verification covers all training rows.
  const exps = margins.map((margin) => Math.exp(margin - maximum));
  const denominator = exps.reduce((a, b) => a + b, 0);
  return exps.map((value) => value / denominator);
}

function classResult(classes, probabilities) {
  const classIndex = probabilities.indexOf(Math.max(...probabilities));
  return { classIndex, label: classes[classIndex],
    probabilities: Object.fromEntries(classes.map((name, k) => [name, probabilities[k]])) };
}

export function predictProductivity(model, record) {
  const values = validateFeatures(model, record);
  const rf = rfProbabilities(model.rf, values);
  const xgboost = xgboostProbabilities(model.xgboost, values);
  const averaged = rf.map((prob, k) => (prob + xgboost[k]) / 2);
  const warnings = [];
  for (const name of model.metadata.features) {
    const bounds = model.metadata.trainingRanges[name];
    if (record[name] < bounds.min || record[name] > bounds.max) {
      warnings.push(`${name} is outside the range observed during training.`);
    }
  }
  return {
    ...classResult(model.metadata.classes, averaged),
    members: {
      randomForest: classResult(model.metadata.classes, rf),
      xgboost: classResult(model.metadata.classes, xgboost),
    },
    modelId: model.metadata.id,
    inputs: Object.fromEntries(model.metadata.features.map((name) => [name, record[name]])),
    warnings,
    probabilitiesCalibrated: false,
    status: 'research-prototype',
    trainingThrough: model.metadata.trainingThrough,
  };
}

export function calendarFeatures(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error('Use a date in YYYY-MM-DD format.');
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new Error('The selected date is invalid.');
  }
  const weekday = date.getUTCDay() || 7;
  return { month: date.getUTCMonth() + 1, weekday, isWeekend: Number(weekday >= 6) };
}

export function modelSummary(model) {
  return model.metadata;
}
