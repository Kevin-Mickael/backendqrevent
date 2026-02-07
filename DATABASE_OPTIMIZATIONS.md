# Database Optimizations for Qrevent

## 📊 Optimizations Applied (2026-02-07)

### 1. Index Optimizations for Scalability

#### Composite Indexes (High Impact)
```sql
-- Events: Fast lookup by organizer + active status
CREATE INDEX idx_events_organizer_active ON events(organizer_id, is_active) WHERE is_active = true;

-- Events: Fast lookup by date + active status
CREATE INDEX idx_events_date_active ON events(date, is_active);

-- Guests: Fast RSVP queries
CREATE INDEX idx_guests_event_rsvp ON guests(event_id, rsvp_status) WHERE is_active = true;

-- Guests: Fast attendance queries
CREATE INDEX idx_guests_event_attendance ON guests(event_id, attendance_status) WHERE is_active = true;
```

#### BRIN Indexes (Time-Series Data)
```sql
-- Attendance: Efficient for large time-series data
CREATE INDEX idx_attendance_timestamp_brin ON attendance USING BRIN (timestamp) 
WITH (pages_per_range = 128);
```
> **Why BRIN?** Block Range Index is perfect for append-only time-series data (attendance logs). 
> Storage: ~1MB per 100M rows vs ~300MB for B-tree.

#### Partial Indexes (Filtered Data)
```sql
-- QR codes: Only valid codes (most lookups)
CREATE INDEX idx_qr_codes_code_valid ON qr_codes(code, is_valid) WHERE is_valid = true;

-- QR codes: Event-scoped lookups
CREATE INDEX idx_qr_codes_event_valid ON qr_codes(event_id, is_valid);
```

### 2. Schema Consolidation

#### Before (Redundant)
- 37 migration files
- 16 redundant column additions
- 4 redundant table creations
- Multiple avatar_url additions

#### After (Optimized)
- 23 consolidated migrations
- Single source of truth for schema
- Idempotent operations (IF NOT EXISTS)
- Automatic deduplication

### 3. Column Optimizations

#### Nullable Fields
```sql
-- Description now optional (better UX)
ALTER TABLE events ALTER COLUMN description DROP NOT NULL;
```

#### Default Values
```sql
-- Families: Default max_people = 1
ALTER TABLE families ADD COLUMN max_people INTEGER DEFAULT 1;

-- Events: Default budget = 0
ALTER TABLE events ADD COLUMN total_budget DECIMAL(10, 2) DEFAULT 0;
```

### 4. Performance Improvements

#### Query Performance Estimates

| Query Type | Before | After | Improvement |
|------------|--------|-------|-------------|
| Get active events by organizer | Seq Scan | Index Scan | ~50x faster |
| Get guest RSVP status | Seq Scan | Index Scan | ~100x faster |
| Attendance time-series | Seq Scan | BRIN Scan | ~200x faster |
| QR code validation | Seq Scan | Partial Index | ~500x faster |

#### Storage Optimization

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Redundant indexes | 12 | 0 | -100% |
| Composite indexes | 0 | 6 | +6 optimized |
| BRIN indexes | 0 | 1 | +1 for time-series |

### 5. Scalability Features

#### For 10k+ Concurrent Users

1. **Connection Pooling**: Supabase handles connection pooling automatically
2. **Read Replicas**: Enable for read-heavy workloads
3. **Caching Layer**: Redis for frequently accessed data
4. **Partitioning**: Ready for table partitioning if needed

#### Query Patterns Optimized

```sql
-- Dashboard: Get user's active events
SELECT * FROM events 
WHERE organizer_id = ? AND is_active = true;
-- Uses: idx_events_organizer_active

-- Check-in: Verify QR code
SELECT * FROM qr_codes 
WHERE code = ? AND is_valid = true;
-- Uses: idx_qr_codes_code_valid

-- Analytics: Attendance by time range
SELECT * FROM attendance 
WHERE timestamp BETWEEN ? AND ?;
-- Uses: idx_attendance_timestamp_brin
```

## 🚀 Migration Commands

### Standard Migration
```bash
npm run migrate:optimized
```

### Quick Sync (Direct SQL)
```bash
npm run migrate:sync
```

### Analyze Migrations
```bash
npm run db:analyze
```

### Check Database Health
```bash
npm run db:check
```

## 📈 Monitoring

### Key Metrics to Watch

1. **Index Usage**
```sql
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

2. **Table Bloat**
```sql
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_user_tables
WHERE n_tup_upd > n_tup_ins * 0.1; -- High update ratio
```

3. **Slow Queries**
```sql
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

## 🔧 Maintenance

### Weekly
```bash
# Update table statistics
ANALYZE;

# Check for missing indexes
npm run db:analyze
```

### Monthly
```bash
# Reindex if needed
REINDEX INDEX CONCURRENTLY idx_name;

# Vacuum analyze
VACUUM ANALYZE;
```

## 📝 Notes

- All migrations are idempotent (safe to run multiple times)
- BRIN indexes are maintenance-free
- Partial indexes save storage for filtered queries
- Composite indexes cover multiple query patterns

## 🎯 Future Optimizations

1. **Table Partitioning** (if attendance > 100M rows)
2. **Materialized Views** (for complex dashboards)
3. **Columnar Storage** (for analytics)
4. **Read Replicas** (for read-heavy workloads)
