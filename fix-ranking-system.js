// Fix pour le système de classement des jeux
// Corrige les problèmes de rangs et statistiques identifiés

const { supabaseService } = require('./config/supabase');

async function fixRankingSystem() {
  try {
    console.log('🔧 Début de la réparation du système de classement...');
    
    // 1. Corriger la fonction de calcul des rangs
    console.log('1️⃣ Correction de la fonction update_game_leaderboard...');
    
    const fixFunction = `
      CREATE OR REPLACE FUNCTION update_game_leaderboard(p_game_id UUID DEFAULT NULL)
      RETURNS void AS 
      $func$
      DECLARE
          game_record RECORD;
      BEGIN
          -- Si p_game_id est fourni, ne traiter que ce jeu
          -- Sinon, traiter tous les jeux
          FOR game_record IN 
              SELECT DISTINCT game_id 
              FROM game_participations
              WHERE (p_game_id IS NULL OR game_id = p_game_id)
                AND is_completed = true
          LOOP
              -- Mettre à jour les rangs pour ce jeu spécifique
              WITH ranked_participants AS (
                  SELECT 
                      id,
                      ROW_NUMBER() OVER (
                          ORDER BY total_score DESC, 
                                   completed_at ASC
                      ) as new_rank
                  FROM game_participations
                  WHERE game_id = game_record.game_id 
                    AND is_completed = true
              )
              UPDATE game_participations gp
              SET rank = rp.new_rank,
                  updated_at = CURRENT_TIMESTAMP
              FROM ranked_participants rp
              WHERE gp.id = rp.id;
              
          END LOOP;
          
      EXCEPTION
          WHEN OTHERS THEN
              -- Log l'erreur mais ne pas échouer
              RAISE NOTICE 'Error updating leaderboard: %', SQLERRM;
      END;
      $func$ LANGUAGE plpgsql SECURITY INVOKER;
    `;

    try {
      const { error: functionError } = await supabaseService.rpc('exec_sql', {
        sql: fixFunction
      });

      if (functionError) {
        console.error('❌ Erreur lors de la création de la fonction:', functionError);
        console.log('⚠️ Continuons sans la fonction SQL...');
      } else {
        console.log('✅ Fonction update_game_leaderboard corrigée');
      }
    } catch (rpcError) {
      console.log('⚠️ Function exec_sql non disponible, continuons avec l\'approche manuelle...');
    }

    // 2. Recalculer tous les rangs manuellement avec des requêtes directes
    console.log('2️⃣ Recalcul des rangs pour tous les jeux...');
    
    // Récupérer tous les jeux avec participations
    const { data: games, error: gamesError } = await supabaseService
      .from('game_participations')
      .select('game_id')
      .eq('is_completed', true);

    if (gamesError) {
      console.error('❌ Erreur lors de la récupération des jeux:', gamesError);
      return;
    }

    // Obtenir la liste unique des game_ids
    const uniqueGameIds = [...new Set(games.map(g => g.game_id))];
    console.log(`🎮 Trouvé ${uniqueGameIds.length} jeux avec des participations complètes`);

    // Pour chaque jeu, recalculer les rangs
    for (const gameId of uniqueGameIds) {
      console.log(`🔄 Traitement du jeu ${gameId}...`);
      
      // Récupérer toutes les participations de ce jeu, triées par score
      const { data: participations, error: partError } = await supabaseService
        .from('game_participations')
        .select('id, total_score, completed_at')
        .eq('game_id', gameId)
        .eq('is_completed', true)
        .order('total_score', { ascending: false })
        .order('completed_at', { ascending: true });

      if (partError) {
        console.error(`❌ Erreur pour le jeu ${gameId}:`, partError);
        continue;
      }

      // Attribuer les rangs
      for (let i = 0; i < participations.length; i++) {
        const participation = participations[i];
        const rank = i + 1;

        const { error: updateError } = await supabaseService
          .from('game_participations')
          .update({ 
            rank: rank,
            updated_at: new Date().toISOString()
          })
          .eq('id', participation.id);

        if (updateError) {
          console.error(`❌ Erreur mise à jour rang pour participation ${participation.id}:`, updateError);
        }
      }

      console.log(`✅ Jeu ${gameId}: ${participations.length} rangs mis à jour`);
    }

    // 3. Vérification des résultats
    console.log('3️⃣ Vérification des résultats...');
    
    const { data: rankStats, error: statsError } = await supabaseService
      .from('game_participations')
      .select('game_id, rank, total_score')
      .eq('is_completed', true)
      .not('rank', 'is', null)
      .order('game_id')
      .order('rank');

    if (statsError) {
      console.error('❌ Erreur lors de la vérification:', statsError);
    } else {
      // Grouper par jeu pour afficher les statistiques
      const statsByGame = {};
      rankStats.forEach(stat => {
        if (!statsByGame[stat.game_id]) {
          statsByGame[stat.game_id] = [];
        }
        statsByGame[stat.game_id].push(stat);
      });

      console.log('📊 Résultats par jeu:');
      Object.entries(statsByGame).forEach(([gameId, participants]) => {
        console.log(`🎮 Jeu ${gameId}: ${participants.length} participants classés`);
        console.log(`   - Premier: rang ${participants[0]?.rank} avec ${participants[0]?.total_score} points`);
        console.log(`   - Dernier: rang ${participants[participants.length-1]?.rank} avec ${participants[participants.length-1]?.total_score} points`);
      });
    }

    // 4. Test du classement public
    console.log('4️⃣ Test du classement public...');
    
    if (uniqueGameIds.length > 0) {
      const testGameId = uniqueGameIds[0];
      const { data: leaderboard, error: lbError } = await supabaseService
        .from('game_participations')
        .select(`
          id,
          total_score,
          correct_answers,
          total_answers,
          rank,
          player_name,
          player_type,
          completed_at
        `)
        .eq('game_id', testGameId)
        .eq('is_completed', true)
        .order('rank', { ascending: true })
        .limit(5);

      if (lbError) {
        console.error('❌ Erreur test classement:', lbError);
      } else {
        console.log(`🏆 Top 5 du jeu ${testGameId}:`);
        leaderboard.forEach((entry, index) => {
          console.log(`   ${entry.rank}. ${entry.player_name || 'Anonyme'} - ${entry.total_score} points (${entry.correct_answers}/${entry.total_answers})`);
        });
      }
    }

    console.log('✅ Système de classement réparé avec succès!');
    
  } catch (error) {
    console.error('💥 Erreur générale:', error);
    throw error;
  }
}

// Exécution du script
if (require.main === module) {
  fixRankingSystem()
    .then(() => {
      console.log('🎉 Script terminé avec succès!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script échoué:', error);
      process.exit(1);
    });
}

module.exports = { fixRankingSystem };