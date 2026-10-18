# EcoAngler website model

The website uses a real Random Forest and a real XGBoost multiclass model. It averages their three class probabilities equally, then selects the largest probability. It predicts relative daily **reported catches per visitor** as Poor, Good, or High. These outputs are not an individual angler's verified catch probability.

## Automatic inputs

| Feature | Source and definition |
| --- | --- |
| `airTemp` | Arithmetic mean of 24 hourly Open-Meteo `temperature_2m` values for the selected local date, °C |
| `windSpeed` | Arithmetic mean of 24 hourly `wind_speed_10m` values, with `wind_speed_unit=kmh` |
| `pressure` | Arithmetic mean of 24 hourly `pressure_msl` values, hPa |
| `month` | Selected local date, 1–12 |
| `weekday` | Selected local date, Monday=1 through Sunday=7 |
| `isWeekend` | 1 on Saturday/Sunday, otherwise 0 |

The model does not require yesterday's catch. Marine temperature, waves, and sea-level information may be shown beside the prediction; they are not supplied as model inputs. A numerical tide height is not interchangeable with the original CSV's tide-cycle category.

This is an explicitly separate **website variant** of the report methodology. It uses the same RF + XGBoost probability-averaging approach while selecting only predictors that the website can collect automatically. It is not the original six-predictor Chapter 3 environmental model.

## Training and evaluation

The unchanged `hanmoku_with_history.csv` supplies dates and catch-per-visitor outcomes. Its original air temperature, wind speed, and pressure columns have unverified units/aggregation, so those three columns are replaced during this training experiment with date-aligned historical weather from Open-Meteo. Each historical day must have all 24 hourly values for each variable. The CSV is not edited.

`model_card.json` records the actual joined row count, excluded rows, source hashes, archive units and grid coordinates, package versions, hyperparameters, cutoffs, and measured metrics. All training/evaluation partitions learn their own tercile cutoffs. The final serving models are refitted on all aligned rows and use fixed full-training cutoffs saved in the model.

Both members use the same shuffled 10-fold partitions. An additional chronological 80/20 diagnostic fits on earlier rows and evaluates later rows. No hyperparameter search, ensemble-weight tuning, or outcome-dependent feature selection was performed. The chronological block has been inspected in previous experiments and is not a new untouched test set. Shuffled-date performance does not establish future accuracy.

## Files and execution

- `website_model.json`: portable numeric trees and metadata consumed by the website's server.
- `inference.mjs`: inference without Python or an external machine-learning service.
- `train_website_model.py`: reproducible training and export code.
- `website_rf.joblib`, `website_xgboost.joblib`: matching Python models for research/retraining; the website does not load these files.
- `model_card.json`, `evaluation.json`: recorded methodology and measured results.
- `verification.json`: actual JavaScript-versus-Python probability and class checks.

Train with Python using NumPy, pandas, scikit-learn, XGBoost and joblib:

```sh
python train_website_model.py --csv hanmoku_with_history.csv --weather-json honmoku_archive.json --out model_output
node verify_inference.mjs model_output
```

For the historical JSON, request the original catch dates at the verified Japanese facility coordinates, `timezone=Asia/Tokyo`, `temperature_unit=celsius`, `wind_speed_unit=kmh`, and `hourly=temperature_2m,wind_speed_10m,pressure_msl` from [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api). Keep the response unchanged for provenance. The training script verifies its units and timezone before joining it.

## Practical limits

The catch data comes from one Japanese fishing facility. Using the model for Malaysian fishing places is an experimental transfer and has not been validated with Malaysian outcomes. Training uses historical weather reanalysis; serving uses weather forecasts. Matching units and aggregation reduces an avoidable input mismatch but does not prove predictive performance under forecast error or in new locations. Scores are uncalibrated. Use local observed catches and saved forecast vintages for subsequent evaluation and retraining.

The original report's water temperature, weather description, and tide-cycle categories are excluded here because their automatic API mappings have not been validated. No tide categories or catch history are fabricated. Missing API inputs should produce an honest unavailable state rather than substitute model inputs.

Sources: [Weather API variables and units](https://open-meteo.com/en/docs), [historical weather and reanalysis](https://open-meteo.com/en/docs/historical-weather-api), [Marine API sea-level and temperature definitions](https://open-meteo.com/en/docs/marine-weather-api).
