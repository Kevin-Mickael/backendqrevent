# Sauvegarde État des Migrations - 2026-02-08

## Contexte
Avant optimisation majeure, état des migrations sauvegardé pour rollback si nécessaire.

## Migrations Existantes (47 fichiers)
```
002_add_files_table.sql
003_secure_tables.sql
001_create_tables.sql ⭐ BASE
004_add_avatar_to_users.sql
add_avatar_url.sql
001_add_avatar_url.sql (DOUBLON)
005_add_story_events_table.sql
006_create_families_table.sql ⚠️ CONFLIT NUMÉRO
006_add_games_tables.sql ⚠️ CONFLIT NUMÉRO
002_add_couple_names.sql (DOUBLON NUMÉRO)
007_create_family_invitations.sql
007_add_guest_game_access.sql ⚠️ CONFLIT NUMÉRO
008_add_dashboard_optimizations.sql ⭐ VUES MATÉRIALISÉES
007_add_performance_indexes.sql ⚠️ CONFLIT NUMÉRO
009_create_wishes_table.sql
009_add_feedback_table.sql ⚠️ CONFLIT NUMÉRO
010_create_seating_tables.sql
006_add_games_tables_fixed.sql ⚠️ CONFLIT NUMÉRO
008b_add_is_active_to_guests.sql
011_link_families_to_tables.sql
001_create_rpc_functions.sql (DOUBLON NUMÉRO)
012_add_preferences_to_users.sql
013_create_audit_logging.sql
014_create_budget_items_table.sql
015_add_quantity_unit_price.sql
016_add_total_budget_to_events.sql
017_add_menu_settings_to_events.sql
017_add_budget_item_details.sql ⚠️ CONFLIT NUMÉRO
018_create_messages_tables.sql
019_secure_messages_rls.sql
020_create_event_gallery_table.sql
020_security_fixes.sql ⚠️ CONFLIT NUMÉRO
018_add_max_people_to_families.sql ⚠️ CONFLIT NUMÉRO
022_cleanup_test_events.sql
019_make_description_nullable.sql ⚠️ CONFLIT NUMÉRO
023_consolidated_schema_optimization.sql ⭐ TENTATIVE CONSOLIDATION
999_final_schema_sync.sql ⭐ SYNC FINAL
EXECUTE_IN_SUPABASE_SQL_EDITOR.sql
024_create_robust_menu_system.sql
025_enforce_event_isolation.sql
026_secure_event_creation_function.sql
021_add_guest_count_to_events.sql ⚠️ CONFLIT NUMÉRO
027_ensure_max_people_column.sql
028_add_family_id_to_qr_codes.sql
030_fix_qr_codes_trigger.sql
029_add_ceremony_reception_venues.sql ⚠️ ORDRE INCORRECT
030_add_event_schedule.sql ⚠️ CONFLIT NUMÉRO
031_add_simple_event_schedule.sql
032_add_partner_names_and_schedule.sql
033_simple_add_columns.sql
034_add_public_game_access.sql
035_fix_missing_game_guest_access.sql
036_add_ip_tracking.sql
037_fix_guest_id_nullable.sql
```

## Problèmes Identifiés

### Conflits de Numérotation
- Numéro 001: 3 fichiers ❌
- Numéro 006: 3 fichiers ❌
- Numéro 007: 3 fichiers ❌
- Numéro 009: 2 fichiers ❌
- Numéro 017: 2 fichiers ❌
- Numéro 018: 2 fichiers ❌
- Numéro 019: 2 fichiers ❌
- Numéro 020: 2 fichiers ❌
- Numéro 021: 2 fichiers ❌
- Numéro 030: 2 fichiers ❌

### Ordre d'Exécution Compromis
- Migration 029 après 030
- Dépendances potentiellement cassées

### Tables Manquantes (selon db:check)
- users
- events  
- guests
- qr_codes
- attendance
- families
- family_invitations
- family_rsvp
- story_events
- games
- game_questions
- game_participations
- feedbacks

## Solution Appliquée
✅ Création de `100_SAFE_database_optimization.sql` qui:
- Ne supprime AUCUNE migration existante
- Optimise sans destruction
- Ajoute sécurité progressive
- Maintient compatibilité

## Rollback Possible
Si problème avec migration 100:
```sql
-- Supprimer uniquement les éléments ajoutés
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS audit_logs;
DROP INDEX CONCURRENTLY IF EXISTS idx_guests_event_rsvp_active;
-- etc.
```

## Prochaines Étapes
1. ✅ Tester migration 100
2. ⏳ Exécuter les migrations manquantes de base
3. ⏳ Appliquer l'optimisation
4. ⏳ Vérifier intégrité
5. ⏳ Nettoyer migrations dupliquées (OPTIONNEL)

---
*Sauvegarde créée automatiquement par Claude Code*