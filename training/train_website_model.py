"""Train, evaluate and export EcoAngler's automatic-API website variant.

Training input: the user's unchanged hanmoku_with_history.csv. Only weather
numeric values and calendar values are predictors; no catch history is needed.
Run with --csv INPUT --out OUTPUT. Packages: numpy pandas sklearn xgboost joblib.
"""
from pathlib import Path
import argparse, hashlib, json, platform
import numpy as np
import pandas as pd
import joblib
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import KFold
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, confusion_matrix
import xgboost as xgb

FEATURES = ['airTemp', 'windSpeed', 'pressure', 'month', 'weekday', 'isWeekend']
CLASSES = ['Poor', 'Good', 'High']
RF_PARAMS = dict(n_estimators=300, max_depth=8, min_samples_leaf=5,
                 max_features='sqrt', random_state=42, n_jobs=2)
XGB_PARAMS = dict(n_estimators=300, max_depth=3, learning_rate=.05,
    min_child_weight=5, subsample=.85, colsample_bytree=.85, reg_lambda=3,
    objective='multi:softprob', num_class=3, eval_metric='mlogloss',
    tree_method='hist', random_state=42, n_jobs=2)

def labels(rates, cuts):
    return np.searchsorted(cuts, np.asarray(rates), side='left')

def pair(x, y):
    if set(np.unique(y)) != {0, 1, 2}:
        raise ValueError('Training outcomes must support all three productivity classes')
    rf = make_pipeline(SimpleImputer(strategy='median'), RandomForestClassifier(**RF_PARAMS))
    xb = make_pipeline(SimpleImputer(strategy='median'), xgb.XGBClassifier(**XGB_PARAMS))
    return rf.fit(x, y), xb.fit(x, y)

def probabilities(models, x):
    a, b = [np.asarray(m.predict_proba(x), float) for m in models]
    a /= a.sum(axis=1, keepdims=True)
    b /= b.sum(axis=1, keepdims=True)
    return {'Random Forest': a, 'XGBoost': b, 'Ensemble': (a+b)/2}

def metrics(y, prob):
    p = prob.argmax(axis=1)
    return {'accuracy': float(accuracy_score(y,p)),
        'f1Macro': float(f1_score(y,p,labels=[0,1,2],average='macro',zero_division=0)),
        'precisionMacro': float(precision_score(y,p,labels=[0,1,2],average='macro',zero_division=0)),
        'recallMacro': float(recall_score(y,p,labels=[0,1,2],average='macro',zero_division=0)),
        'confusionMatrix': confusion_matrix(y,p,labels=[0,1,2]).tolist()}

def export_rf(pipeline):
    forest = pipeline[-1]
    trees = []
    for est in forest.estimators_:
        t = est.tree_
        nodes=[]
        for i in range(t.node_count):
            if t.children_left[i] < 0:
                values=t.value[i,0,:].astype(float)
                nodes.append((values/values.sum()).tolist())
            else:
                nodes.append([int(t.feature[i]),float(t.threshold[i]),
                              int(t.children_left[i]),int(t.children_right[i])])
        trees.append(nodes)
    return trees

def export_xgb(pipeline):
    booster = pipeline[-1].get_booster()
    raw = json.loads(booster.save_raw(raw_format='json'))['learner']
    base = raw['learner_model_param']['base_score']
    base = json.loads(base) if base.startswith('[') else [float(base)]*3
    native = raw['gradient_booster']['model']
    trees=[]
    for t, group in zip(native['trees'],native['tree_info']):
        if any(t.get('split_type', [])):
            raise ValueError('Categorical XGBoost splits are not supported by this numeric exporter')
        nodes=[]
        for i, left in enumerate(t['left_children']):
            if left < 0:
                nodes.append([float(t['split_conditions'][i])])
            else:
                nodes.append([int(t['split_indices'][i]),float(t['split_conditions'][i]),
                              int(left),int(t['right_children'][i])])
        trees.append({'classIndex':int(group),'nodes':nodes})
    return {'baseMargins':base,'trees':trees}

def main():
    p=argparse.ArgumentParser();p.add_argument('--csv', required=True);p.add_argument('--out',required=True)
    p.add_argument('--weather-json',required=True,help='Open-Meteo archive hourly JSON with three numeric weather variables')
    args=p.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    source=Path(args.csv);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    df=pd.read_csv(source,na_values=['?'])
    df['date']=pd.to_datetime(df.date,format='%d/%m/%Y',errors='raise')
    df=df.sort_values('date').reset_index(drop=True)
    if df.date.duplicated().any():raise ValueError('Duplicate dates')
    outcomes=df[['catchPerVisitor','totalCatch','visitors']].apply(pd.to_numeric,errors='raise')
    if not np.isfinite(outcomes.to_numpy()).all() or (df.visitors<=0).any() or (df.totalCatch<0).any():
        raise ValueError('Invalid or missing catch/visitor outcomes')
    if not np.allclose(df.catchPerVisitor,df.totalCatch/df.visitors,rtol=1e-8,atol=1e-8):
        raise ValueError('Catch-per-visitor arithmetic does not agree')
    # Replace the CSV weather columns: their unit and aggregation provenance is
    # unknown. Reanalysis hourly variables have explicit API units and are joined
    # to catch outcomes on the local date, with the same daily mean as serving.
    weather_path=Path(args.weather_json)
    weather_raw=json.loads(weather_path.read_text(encoding='utf-8-sig'))
    if weather_raw.get('error'):raise ValueError(weather_raw.get('reason','Archive API error'))
    expected_units={'temperature_2m':'°C','wind_speed_10m':'km/h','pressure_msl':'hPa'}
    for col,unit in expected_units.items():
        if weather_raw.get('hourly_units',{}).get(col)!=unit:
            raise ValueError(f'Expected {unit} for {col}, got {weather_raw.get("hourly_units",{}).get(col)}')
    if weather_raw.get('timezone')!='Asia/Tokyo':raise ValueError('Historical weather must use Asia/Tokyo local dates')
    weather=pd.DataFrame(weather_raw['hourly'])
    weather['date']=pd.to_datetime(weather['time']).dt.normalize()
    columns=list(expected_units)
    counts=weather.groupby('date')[columns].count()
    means=weather.groupby('date')[columns].mean()
    complete=means.loc[(counts==24).all(axis=1)].rename(columns={
        'temperature_2m':'airTemp','wind_speed_10m':'windSpeed','pressure_msl':'pressure'})
    original_rows=len(df)
    df=df.drop(columns=['airTemp','windSpeed','pressure']).merge(complete,on='date',how='inner').sort_values('date').reset_index(drop=True)
    if len(df)<100:raise ValueError('Too few aligned historical days for reliable training')
    # Derive calendar values instead of trusting supplied calendar columns.
    df['month']=df.date.dt.month
    df['weekday']=df.date.dt.dayofweek+1
    df['isWeekend']=(df.date.dt.dayofweek>=5).astype(int)
    x=df[FEATURES].apply(pd.to_numeric,errors='raise')
    if not np.isfinite(x.to_numpy()).all():raise ValueError('Missing numeric training predictors')
    n=len(df);oof={name:np.zeros((n,3)) for name in ['Random Forest','XGBoost','Ensemble']}
    truth=np.zeros(n,dtype=int);folds=[]
    for fold,(tr,va) in enumerate(KFold(n_splits=10,shuffle=True,random_state=42).split(x),1):
        cuts=np.quantile(df.catchPerVisitor.iloc[tr],[1/3,2/3])
        ytr=labels(df.catchPerVisitor.iloc[tr],cuts);yva=labels(df.catchPerVisitor.iloc[va],cuts)
        models=pair(x.iloc[tr],ytr);truth[va]=yva
        for name,prob in probabilities(models,x.iloc[va]).items():
            oof[name][va]=prob
            folds.append({'fold':fold,'model':name,**metrics(yva,prob),
                          'lowerCutoff':float(cuts[0]),'upperCutoff':float(cuts[1])})
        print(f'Website variant: CV fold {fold}/10 complete',flush=True)
    evaluation={'random10Fold':{name:metrics(truth,pr) for name,pr in oof.items()}}
    split=int(n*.8);cuts=np.quantile(df.catchPerVisitor.iloc[:split],[1/3,2/3])
    models=pair(x.iloc[:split],labels(df.catchPerVisitor.iloc[:split],cuts))
    evaluation['chronological80_20']={
        'trainingRows':split,'validationRows':n-split,
        'trainingThrough':str(df.date.iloc[split-1].date()),
        'validationFrom':str(df.date.iloc[split].date()),
        'validationThrough':str(df.date.iloc[-1].date()),
        'cutoffs':cuts.tolist(),
        'models':{name:metrics(labels(df.catchPerVisitor.iloc[split:],cuts),pr)
                  for name,pr in probabilities(models,x.iloc[split:]).items()}}
    final_cuts=np.quantile(df.catchPerVisitor,[1/3,2/3])
    final_models=pair(x,labels(df.catchPerVisitor,final_cuts))
    for name,model in zip(['rf','xgboost'],final_models):
        joblib.dump(model,out/f'website_{name}.joblib',compress=3)
    notes=[
        'Research prototype trained on one Japanese fishing facility; not validated for Malaysia or new locations.',
        'Website variant uses six automatic numeric weather/calendar features and differs from Chapter 3 environmental predictors.',
        'The original CSV weather columns have unverified provenance; this model replaces them with date-aligned Open-Meteo historical weather.',
        'Weather aggregation is the arithmetic mean of 24 complete hourly values per local calendar day, in Celsius, km/h and sea-level hPa.',
        'No tide category, water temperature, weather category or catch history is supplied to this website model.',
        'Probabilities are uncalibrated model scores, not verified chances of catching fish.',
        'Random shuffled CV mixes dates and is a diagnostic, not evidence of future accuracy.',
        'The later catch dates have been examined in previous experiments, so chronological results are reused diagnostics, not a fresh holdout.',
        'Training uses historical weather reanalysis, while serving uses advance forecasts; performance on advance forecasts has not been established.',
        'Relative tercile class thresholds are fitted within each evaluation training partition; final serving model has fixed full-training thresholds.',
        'Do not interpret reported catches per visitor as a universal catch guarantee or boating safety advice.'
    ]
    metadata={'id':'ecoangler-api-v1','displayName':'EcoAngler RF + XGBoost',
        'version':'2026-10-17','features':FEATURES,'classes':CLASSES,
        'weights':[.5,.5],'target':'reported catches per visitor',
        'classCutoffs':final_cuts.tolist(),'trainingRows':n,
        'trainingFrom':str(df.date.iloc[0].date()),'trainingThrough':str(df.date.iloc[-1].date()),
        'trained_through':str(df.date.iloc[-1].date()),
        'cv_accuracy':evaluation['random10Fold']['Ensemble']['accuracy'],
        'chronological_accuracy':evaluation['chronological80_20']['models']['Ensemble']['accuracy'],
        'chronological_macro_f1':evaluation['chronological80_20']['models']['Ensemble']['f1Macro'],
        'trainingLocation':'Honmoku, Japan',
        'sourceFile':source.name,'sourceSha256':source_hash,
        'originalCatchRows':original_rows,'excludedWithoutCompleteHistoricalWeather':original_rows-len(df),
        'historicalWeather':{'source':'Open-Meteo Historical Weather API',
            'file':weather_path.name,'sha256':hashlib.sha256(weather_path.read_bytes()).hexdigest(),
            'latitude':weather_raw.get('latitude'),'longitude':weather_raw.get('longitude'),
            'requestedLatitude':35.4267,'requestedLongitude':139.6863,
            'timezone':weather_raw.get('timezone'),'hourlyUnits':weather_raw.get('hourly_units'),
            'aggregation':'Arithmetic mean of 24 complete hourly values per local calendar date'},
        'trainingRanges':{c:{'min':float(x[c].min()),'max':float(x[c].max())} for c in FEATURES},
        'featureUnits':{'airTemp':'°C','windSpeed':'km/h','pressure':'hPa','month':'1–12','weekday':'Monday=1, Sunday=7','isWeekend':'0 or 1'},
        'apiMapping':{'airTemp':'daily mean of hourly temperature_2m',
                      'windSpeed':'daily mean of hourly wind_speed_10m; wind_speed_unit=kmh',
                      'pressure':'daily mean of hourly pressure_msl',
                      'month':'selected local date month',
                      'weekday':'selected local date day of week, Monday=1',
                      'isWeekend':'selected local date Saturday/Sunday'},
        'status':'research-prototype','probabilitiesCalibrated':False,
        'parameters':{'rf':RF_PARAMS,'xgboost':XGB_PARAMS},
        'versions':{'python':platform.python_version(),'numpy':np.__version__,
            'pandas':pd.__version__,'scikit-learn':sklearn.__version__,'xgboost':xgb.__version__},
        'evaluation':evaluation,'limitations':notes,
        'sources':['https://open-meteo.com/en/docs','https://open-meteo.com/en/docs/historical-weather-api','https://open-meteo.com/en/docs/marine-weather-api']}
    exported={'formatVersion':1,'metadata':metadata,
        'imputationMedians':final_models[0][0].statistics_.tolist(),
        'rf':{'trees':export_rf(final_models[0])},'xgboost':export_xgb(final_models[1])}
    (out/'website_model.json').write_text(json.dumps(exported,separators=(',',':'),ensure_ascii=False),encoding='utf-8')
    (out/'model_card.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False),encoding='utf-8')
    (out/'evaluation.json').write_text(json.dumps(evaluation,indent=2),encoding='utf-8')
    (out/'cv_fold_metrics.json').write_text(json.dumps(folds,indent=2),encoding='utf-8')
    df[['date']+FEATURES+['catchPerVisitor']].assign(date=lambda d:d.date.dt.strftime('%Y-%m-%d')).to_csv(out/'aligned_training_data.csv',index=False)
    # Reference cases include every input row plus random in-range numeric inputs.
    rng=np.random.default_rng(408)
    random=x.iloc[rng.integers(0,n,400)].copy().reset_index(drop=True)
    for col in ['airTemp','windSpeed','pressure']:
        random[col]=rng.uniform(x[col].min(),x[col].max(),len(random))
    cases=pd.concat([x,random],ignore_index=True)
    expected=probabilities(final_models,cases)
    fixtures=[{'input':row,'expected':{name:expected[name][i].tolist() for name in expected}}
              for i,row in enumerate(cases.to_dict(orient='records'))]
    (out/'verification_cases.json').write_text(json.dumps(fixtures,separators=(',',':')),encoding='utf-8')
    if hashlib.sha256(source.read_bytes()).hexdigest()!=source_hash:raise AssertionError('Original CSV changed')
    print(json.dumps({'evaluation':evaluation,'exportBytes':(out/'website_model.json').stat().st_size},indent=2))

if __name__=='__main__':main()
