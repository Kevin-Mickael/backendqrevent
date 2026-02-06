# Load Testing Suite

Suite de tests de charge pour Qrevent utilisant k6.

## 📋 Prérequis

```bash
# Installer k6
# macOS
brew install k6

# Ubuntu/Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## 🚀 Exécution des Tests

### 1. Test Dashboard (Charge standard)

```bash
# Variables requises
export API_URL="http://localhost:5000/api"
export AUTH_TOKEN="votre-jwt-token"
export TEST_EVENT_ID="votre-event-id"

# Exécuter le test
k6 run dashboard-load-test.js

# Avec plus d'utilisateurs
k6 run --vus 200 --duration 10m dashboard-load-test.js

# Via Docker
docker run -i grafana/k6 run - <dashboard-load-test.js \
  -e API_URL=http://host.docker.internal:5000/api \
  -e AUTH_TOKEN=votre-token
```

### 2. Test Jeux (Charge massive)

```bash
export API_URL="http://localhost:5000/api"
export TEST_GAME_ID="votre-game-id"
export TEST_EVENT_ID="votre-event-id"

# Test avec 500 joueurs virtuels
k6 run game-load-test.js

# Test de résilience (spike à 1000 joueurs)
k6 run --vus 1000 --duration 15m game-load-test.js
```

## 📊 Scénarios de Test

### Dashboard Test

| Phase | Durée | Users | Objectif |
|-------|-------|-------|----------|
| Ramp up | 2m | 0→50 | Montée progressive |
| Steady | 5m | 50 | Charge normale |
| Ramp up | 2m | 50→100 | Augmentation |
| Steady | 5m | 100 | Charge élevée |
| Ramp up | 2m | 100→200 | Charge maximale |
| Steady | 5m | 200 | Test de résistance |
| Ramp down | 2m | 200→0 | Redescente |

### Game Test

| Scénario | Phase | Users | Description |
|----------|-------|-------|-------------|
| Ramp up | 2m | 0→100 | Progressive |
| Ramp up | 2m | 100→300 | Montée |
| Ramp up | 2m | 300→500 | Pic |
| Steady | 5m | 500 | Maintien |
| Spike | 30s | 50→1000 | Test crash |
| Steady | 5m | 1000 | Résilience |

## 🎯 Critères de Succès

### Dashboard
- p(95) response time < 500ms
- Error rate < 1%
- Dashboard load < 400ms (p95)

### Game
- p(95) submit answer < 200ms
- p(95) join game < 400ms
- Error rate < 2%

## 📈 Analyse des Résultats

### Métriques Clés

```bash
# Exporter vers InfluxDB (Grafana)
k6 run --out influxdb=http://localhost:8086/k6 dashboard-load-test.js

# Exporter vers JSON
k6 run --out json=results.json dashboard-load-test.js

# Exporter vers CSV
k6 run --out csv=results.csv dashboard-load-test.js
```

### Interprétation

```
http_req_duration..........: avg=145ms  min=23ms   med=112ms  max=2.34s  p(90)=245ms  p(95)=312ms
✅ Bon: p(95) < 500ms
⚠️  Attention: p(95) entre 500-1000ms
❌ Critique: p(95) > 1000ms

http_req_failed............: 0.01%
✅ Bon: < 1%
⚠️  Attention: 1-5%
❌ Critique: > 5%

dashboard_load_time........: avg=125ms  p(95)=280ms
✅ Bon: < 400ms
```

## 🔧 Debugging

### En cas d'échec

1. **Vérifier les logs API**
   ```bash
   tail -f backend/logs/error.log
   ```

2. **Vérifier les métriques DB**
   ```bash
   node scripts/monitor-performance.js
   ```

3. **Vérifier les connexions Redis**
   ```bash
   redis-cli info clients
   ```

### Optimisations si échec

| Problème | Solution |
|----------|----------|
| Timeout | Augmenter les workers Node.js |
| DB surcharge | Vérifier les index, ajouter du cache |
| Memory leak | Profiler avec clinic.js |
| Redis saturé | Augmenter la mémoire Redis |

## 📁 Fichiers

| Fichier | Description |
|---------|-------------|
| `dashboard-load-test.js` | Test charge dashboard |
| `game-load-test.js` | Test charge jeux (massif) |
| `README.md` | Ce fichier |

## 🆘 Support

En cas de problème:
1. Vérifier que l'API tourne: `curl http://localhost:5000/health`
2. Vérifier les logs k6: `k6 run --verbose dashboard-load-test.js`
3. Contacter l'équipe avec les logs d'erreur
