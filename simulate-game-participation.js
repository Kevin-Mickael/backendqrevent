// Script de simulation pour tester le système de jeux avec des données fictives
// Crée des participations de test pour vérifier les rangs et classements

const { supabaseService } = require('./config/supabase');
const { v4: uuidv4 } = require('uuid');

async function simulateGameParticipation() {
  console.log('🎭 Simulation de participations de jeu...\n');

  try {
    // 1. Récupérer un jeu actif
    console.log('1️⃣ Recherche d\'un jeu actif...');
    const { data: games, error: gamesError } = await supabaseService
      .from('games')
      .select('id, name, event_id')
      .eq('is_active', true)
      .eq('status', 'active')
      .limit(1);

    if (gamesError || !games || games.length === 0) {
      console.error('❌ Aucun jeu actif trouvé. Créez d\'abord un jeu via le dashboard.');
      return;
    }

    const testGame = games[0];
    console.log(`✅ Jeu sélectionné: ${testGame.name} (${testGame.id})`);

    // 2. Créer des participations fictives
    console.log('\n2️⃣ Création de participations fictives...');
    
    const simulatedParticipations = [
      {
        player_name: 'Alice Dupont',
        total_score: 85,
        correct_answers: 4,
        total_answers: 5,
        player_type: 'individual'
      },
      {
        player_name: 'Bob Martin',
        total_score: 92,
        correct_answers: 4,
        total_answers: 4,
        player_type: 'individual'
      },
      {
        player_name: 'Famille Durand',
        total_score: 78,
        correct_answers: 3,
        total_answers: 5,
        player_type: 'family'
      },
      {
        player_name: 'Charlie Leroy',
        total_score: 95,
        correct_answers: 5,
        total_answers: 5,
        player_type: 'individual'
      },
      {
        player_name: 'Famille Bernard',
        total_score: 60,
        correct_answers: 2,
        total_answers: 4,
        player_type: 'family'
      }
    ];

    // Insérer les participations
    for (const participation of simulatedParticipations) {
      const participationData = {
        game_id: testGame.id,
        player_name: participation.player_name,
        player_type: participation.player_type,
        total_score: participation.total_score,
        correct_answers: participation.correct_answers,
        total_answers: participation.total_answers,
        is_completed: true,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        access_token: `test_${Math.random().toString(36).substring(2, 15)}`
      };

      const { data, error } = await supabaseService
        .from('game_participations')
        .insert([participationData])
        .select();

      if (error) {
        console.error(`❌ Erreur insertion ${participation.player_name}:`, error);
      } else {
        console.log(`✅ ${participation.player_name}: ${participation.total_score} points`);
      }
    }

    // 3. Vérifier le leaderboard après insertion
    console.log('\n3️⃣ Vérification du leaderboard...');
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Attendre un peu

    try {
      const response = await fetch(`http://localhost:5000/api/games/public/${testGame.id}/leaderboard`);
      const leaderboardData = await response.json();

      if (leaderboardData.success) {
        const leaderboard = leaderboardData.data.leaderboard;
        console.log(`📊 Classement final (${leaderboard.length} participants):`);
        
        leaderboard.forEach((entry, index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
          console.log(`   ${medal} ${entry.rank}. ${entry.playerName}: ${entry.score} points (${entry.correctAnswers}/${entry.totalAnswers})`);
        });

        // Vérifier la logique de rang
        console.log('\n4️⃣ Vérification de la logique de classement...');
        let isValid = true;
        for (let i = 0; i < leaderboard.length - 1; i++) {
          const current = leaderboard[i];
          const next = leaderboard[i + 1];
          
          if (current.score < next.score) {
            console.log(`❌ Erreur: ${current.playerName} (${current.score}) classé avant ${next.playerName} (${next.score})`);
            isValid = false;
          }
          
          if (current.rank !== i + 1) {
            console.log(`❌ Erreur de rang: ${current.playerName} a le rang ${current.rank} mais devrait être ${i + 1}`);
            isValid = false;
          }
        }

        if (isValid) {
          console.log('✅ Logique de classement correcte !');
        } else {
          console.log('❌ Des erreurs ont été détectées dans le classement');
        }

      } else {
        console.error('❌ Erreur lors de la récupération du leaderboard:', leaderboardData.message);
      }
    } catch (fetchError) {
      console.error('❌ Erreur fetch:', fetchError.message);
      console.log('⚠️ Assurez-vous que le serveur backend tourne sur le port 5000');
    }

    // 5. Test de simulation d'une nouvelle participation
    console.log('\n5️⃣ Test d\'ajout d\'une nouvelle participation...');
    
    const newParticipation = {
      game_id: testGame.id,
      player_name: 'David Nouveau',
      player_type: 'individual',
      total_score: 88, // Score qui devrait le placer 2e ou 3e
      correct_answers: 4,
      total_answers: 5,
      is_completed: true,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      access_token: `test_${Math.random().toString(36).substring(2, 15)}`
    };

    const { data: newData, error: newError } = await supabaseService
      .from('game_participations')
      .insert([newParticipation])
      .select();

    if (newError) {
      console.error('❌ Erreur nouvelle participation:', newError);
    } else {
      console.log(`✅ Nouvelle participation ajoutée: ${newParticipation.player_name} - ${newParticipation.total_score} points`);
      
      // Re-vérifier le classement
      await new Promise(resolve => setTimeout(resolve, 500));
      
      try {
        const response2 = await fetch(`http://localhost:5000/api/games/public/${testGame.id}/leaderboard`);
        const leaderboardData2 = await response2.json();

        if (leaderboardData2.success) {
          const leaderboard2 = leaderboardData2.data.leaderboard;
          console.log(`\n📊 Classement mis à jour (${leaderboard2.length} participants):`);
          
          leaderboard2.slice(0, 5).forEach((entry, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
            const isNew = entry.playerName === newParticipation.player_name ? ' 🆕' : '';
            console.log(`   ${medal} ${entry.rank}. ${entry.playerName}: ${entry.score} points${isNew}`);
          });
        }
      } catch (e) {
        console.error('❌ Erreur lors de la re-vérification:', e.message);
      }
    }

    console.log('\n✅ Simulation terminée avec succès !');

  } catch (error) {
    console.error('💥 Erreur générale:', error);
  }
}

// Fonction pour nettoyer les données de test
async function cleanupTestData() {
  console.log('🧹 Nettoyage des données de test...');
  
  const { data, error } = await supabaseService
    .from('game_participations')
    .delete()
    .like('access_token', 'test_%');

  if (error) {
    console.error('❌ Erreur nettoyage:', error);
  } else {
    console.log('✅ Données de test supprimées');
  }
}

// Exécution du script
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--cleanup')) {
    cleanupTestData()
      .then(() => process.exit(0))
      .catch(error => {
        console.error('❌ Erreur nettoyage:', error);
        process.exit(1);
      });
  } else {
    simulateGameParticipation()
      .then(() => {
        console.log('\n🎉 Simulation terminée !');
        console.log('\n💡 Pour nettoyer les données de test: npm run simulate-game -- --cleanup');
        process.exit(0);
      })
      .catch(error => {
        console.error('\n❌ Simulation échouée:', error);
        process.exit(1);
      });
  }
}

module.exports = { simulateGameParticipation, cleanupTestData };