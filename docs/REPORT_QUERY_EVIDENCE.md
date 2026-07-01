# Report Query Evidence

Canonical dashboard API:

```text
GET /api/dashboard/overview?financialYear=:id
```

Main report APIs require `financialYear` and apply authorization-derived plant scope before calculation:

```text
GET /api/reports/target-data?financialYear=:id
GET /api/reports/summary?financialYear=:id
GET /api/reports/plant-performance?financialYear=:id
```

The Mongo report gate runs `explain("executionStats")` for the main Target report query after creating persisted report data and restarting the backend.

Query shape:

```js
Target.find({
  financialYear,
  plant,
  isActive: true
}).explain("executionStats")
```

Index used:

```text
financialYear_1_plant_1_isActive_1_metricType_1_month_1
```

Expected execution evidence:

```text
winningPlan includes IXSCAN
winningPlan indexName is financialYear_1_plant_1_isActive_1_metricType_1_month_1
```

The same report index shape exists on `Actual`, because target-vs-actual calculations read both collections with the same authorization and filter keys.
