#!/bin/bash
# Script pour exécuter la migration 034

echo "🚀 Exécution de la migration 034_add_public_game_access.sql..."
echo ""

# Vérifier si psql est disponible
if command -v psql &> /dev/null; then
    echo "✅ psql trouvé, tentative de connexion directe..."
    
    # Charger les variables d'environnement
    if [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
    fi
    
    if [ -n "$SUPABASE_CONNECTION_STRING" ]; then
        psql "$SUPABASE_CONNECTION_STRING" -f migrations/034_add_public_game_access.sql
        echo ""
        echo "✅ Migration 034 exécutée avec succès!"
    else
        echo "❌ SUPABASE_CONNECTION_STRING non définie dans .env"
        echo "💡 Vous pouvez exécuter la migration manuellement dans l'éditeur SQL Supabase:"
        echo ""
        cat migrations/034_add_public_game_access.sql
    fi
else
    echo "❌ psql non trouvé"
    echo "💡 Copiez ce SQL dans l'éditeur SQL Supabase:"
    echo ""
    cat migrations/034_add_public_game_access.sql
fi
