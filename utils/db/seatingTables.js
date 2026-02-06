const { supabaseService } = require('../../config/supabase');
const logger = require('../logger');

/**
 * 🔧 SEATING TABLES DATABASE UTILITIES - VERSION CORRIGÉE
 * 
 * Corrections appliquées selon rules.md et context.md :
 * - Validation stricte des paramètres
 * - Gestion d'erreurs robuste
 * - Transactions atomiques
 * - Logging pour audit
 * - Sécurité renforcée
 * - Cohérence données frontend/backend
 */

const seatingTablesDb = {
  // ============================================
  // UTILITAIRES DE VALIDATION
  // ============================================

  /**
   * Valide un UUID
   */
  validateUUID: (uuid) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  },

  /**
   * Valide les données d'une table
   */
  validateTableData: (data) => {
    const errors = [];
    
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Table name is required');
    }
    if (data.name && data.name.length > 100) {
      errors.push('Table name must be less than 100 characters');
    }
    if (!data.seats || !Number.isInteger(data.seats) || data.seats < 1 || data.seats > 50) {
      errors.push('Seats must be an integer between 1 and 50');
    }
    if (data.table_shape && !['round', 'rectangular', 'square', 'oval'].includes(data.table_shape)) {
      errors.push('Invalid table shape');
    }
    
    return errors;
  },

  /**
   * Vérifie qu'un utilisateur a accès à un événement
   */
  checkEventAccess: async (eventId, userId) => {
    if (!seatingTablesDb.validateUUID(eventId) || !seatingTablesDb.validateUUID(userId)) {
      throw new Error('Invalid event ID or user ID format');
    }

    const { data: event, error } = await supabaseService
      .from('events')
      .select('id, organizer_id')
      .eq('id', eventId)
      .eq('organizer_id', userId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Event not found or access denied');
      }
      throw new Error(`Database error: ${error.message}`);
    }

    return event;
  },

  /**
   * Vérifie que les tables existent avant d'y faire des requêtes
   */
  checkTablesExist: async () => {
    try {
      // Vérifier l'existence des tables essentielles
      const tables = ['seating_tables', 'table_assignments', 'table_manual_guests'];
      
      for (const table of tables) {
        const { error } = await supabaseService
          .from(table)
          .select('id', { count: 'exact', head: true });
          
        if (error) {
          logger.warn(`Table ${table} may not exist or is inaccessible: ${error.message}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error checking table existence:', error);
      return false;
    }
  },

  // ============================================
  // OPÉRATIONS CRUD SÉCURISÉES
  // ============================================

  /**
   * Créer une nouvelle table de placement
   */
  create: async (tableData, userId) => {
    try {
      // Validation des données
      const validationErrors = seatingTablesDb.validateTableData(tableData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Vérifier l'accès à l'événement
      await seatingTablesDb.checkEventAccess(tableData.event_id, userId);

      // Vérifier que les tables existent
      const tablesExist = await seatingTablesDb.checkTablesExist();
      if (!tablesExist) {
        throw new Error('Database tables are not properly initialized');
      }

      // Vérifier qu'il n'y a pas déjà trop de tables pour cet événement
      const { count, error: countError } = await supabaseService
        .from('seating_tables')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', tableData.event_id);

      if (countError) {
        throw new Error(`Error checking existing tables: ${countError.message}`);
      }

      if (count && count >= 50) {
        throw new Error('Maximum number of tables (50) reached for this event');
      }

      // Préparer les données à insérer
      const dataToInsert = {
        event_id: tableData.event_id,
        name: tableData.name.trim(),
        seats: tableData.seats,
        table_shape: tableData.table_shape || 'round',
        position_x: tableData.position_x || 0,
        position_y: tableData.position_y || 0,
        notes: tableData.notes?.trim() || null
      };

      // Insérer la table
      const { data, error } = await supabaseService
        .from('seating_tables')
        .insert([dataToInsert])
        .select()
        .single();

      if (error) {
        throw new Error(`Error creating seating table: ${error.message}`);
      }

      // Log de l'action pour audit
      logger.info('Seating table created', {
        tableId: data.id,
        eventId: tableData.event_id,
        userId: userId,
        tableName: data.name
      });

      return data;
    } catch (error) {
      logger.error('Error in seatingTablesDb.create:', error);
      throw error;
    }
  },

  /**
   * Récupérer une table par ID avec vérification d'accès
   */
  findById: async (id, userId) => {
    try {
      if (!seatingTablesDb.validateUUID(id)) {
        throw new Error('Invalid table ID format');
      }

      const { data, error } = await supabaseService
        .from('seating_tables')
        .select(`
          *,
          event:event_id(id, organizer_id)
        `)
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Error finding seating table: ${error.message}`);
      }

      // Vérifier l'accès
      if (data.event?.organizer_id !== userId) {
        throw new Error('Access denied to this seating table');
      }

      return data;
    } catch (error) {
      logger.error('Error in seatingTablesDb.findById:', error);
      throw error;
    }
  },

  /**
   * Récupérer les tables d'un événement avec assignations - VERSION CORRIGÉE
   */
  findByEvent: async (eventId, userId) => {
    try {
      // Vérifier l'accès à l'événement
      await seatingTablesDb.checkEventAccess(eventId, userId);

      // Vérifier que les tables existent
      const tablesExist = await seatingTablesDb.checkTablesExist();
      if (!tablesExist) {
        logger.warn('Database tables not initialized, returning empty array');
        return [];
      }

      // Récupérer les tables
      const { data: tables, error } = await supabaseService
        .from('seating_tables')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Error finding seating tables: ${error.message}`);
      }

      if (!tables || tables.length === 0) {
        return [];
      }

      const tableIds = tables.map(t => t.id);
      
      // Récupérer les assignations avec jointures sécurisées
      const { data: assignments, error: assignmentsError } = await supabaseService
        .from('table_assignments')
        .select(`
          id,
          table_id,
          guest_id,
          family_id,
          assignment_type,
          seat_number,
          manual_guest_name,
          manual_guest_count,
          guest:guest_id(id, first_name, last_name, email),
          family:family_id(id, name, members)
        `)
        .in('table_id', tableIds);

      // Ne pas faire échouer si les assignations échouent
      if (assignmentsError) {
        logger.warn('Could not fetch table assignments:', assignmentsError.message);
      }

      // Récupérer les invités manuels
      const { data: manualGuests, error: manualError } = await supabaseService
        .from('table_manual_guests')
        .select('*')
        .in('table_id', tableIds);

      // Ne pas faire échouer si les invités manuels échouent
      if (manualError) {
        logger.warn('Could not fetch manual guests:', manualError.message);
      }

      // Transformer les données de manière sécurisée
      return tables.map(table => {
        const tableAssignments = assignments?.filter(a => a.table_id === table.id) || [];
        const tableManualGuests = manualGuests?.filter(g => g.table_id === table.id) || [];
        
        let occupiedSeats = 0;
        const guests = [];
        const families = [];
        
        // Traiter les assignations avec validation
        tableAssignments.forEach(assignment => {
          if (!assignment) return;

          if (assignment.assignment_type === 'guest' && assignment.guest) {
            occupiedSeats += 1;
            guests.push({
              assignment_id: assignment.id,
              type: 'guest',
              seat_number: assignment.seat_number,
              id: assignment.guest.id,
              first_name: assignment.guest.first_name || '',
              last_name: assignment.guest.last_name || '',
              email: assignment.guest.email || ''
            });
          } else if (assignment.assignment_type === 'family' && assignment.family) {
            const memberCount = Math.max(1, assignment.family.members?.length || 1);
            occupiedSeats += memberCount;
            families.push({
              assignment_id: assignment.id,
              type: 'family',
              seat_number: assignment.seat_number,
              member_count: memberCount,
              id: assignment.family.id,
              name: assignment.family.name || 'Famille'
            });
          } else if (assignment.assignment_type === 'manual' && assignment.manual_guest_name) {
            const guestCount = Math.max(1, assignment.manual_guest_count || 1);
            occupiedSeats += guestCount;
            const nameParts = (assignment.manual_guest_name || 'Invité').split(' ');
            guests.push({
              assignment_id: assignment.id,
              type: 'manual',
              seat_number: assignment.seat_number,
              first_name: nameParts[0] || 'Invité',
              last_name: nameParts.slice(1).join(' ') || '',
              email: null
            });
          }
        });

        // Traiter les invités manuels avec validation
        tableManualGuests.forEach(mg => {
          if (!mg) return;
          occupiedSeats += 1;
          guests.push({
            assignment_id: mg.id,
            type: 'manual_guest',
            seat_number: mg.seat_number,
            first_name: mg.first_name || '',
            last_name: mg.last_name || '',
            email: mg.email || ''
          });
        });

        return {
          ...table,
          occupied_seats: Math.min(occupiedSeats, table.seats), // Éviter l'overflow
          guests,
          families,
          all_assignments: [...guests, ...families]
        };
      });

    } catch (error) {
      logger.error('Error in seatingTablesDb.findByEvent:', error);
      throw error;
    }
  },

  /**
   * Récupérer les invités non assignés - VERSION CORRIGÉE
   */
  getUnassignedGuests: async (eventId, userId) => {
    try {
      // Vérifier l'accès à l'événement
      await seatingTablesDb.checkEventAccess(eventId, userId);

      // Vérifier que les tables existent
      const tablesExist = await seatingTablesDb.checkTablesExist();
      if (!tablesExist) {
        logger.warn('Database tables not initialized for unassigned guests');
        // Retourner tous les invités si les tables de placement n'existent pas
        const { data: allGuests, error } = await supabaseService
          .from('guests')
          .select('id, first_name, last_name, email')
          .eq('event_id', eventId);

        if (error) {
          throw new Error(`Error finding guests: ${error.message}`);
        }

        return allGuests || [];
      }

      // Récupérer tous les invités de l'événement
      const { data: allGuests, error: guestsError } = await supabaseService
        .from('guests')
        .select('id, first_name, last_name, email')
        .eq('event_id', eventId);

      if (guestsError) {
        throw new Error(`Error finding guests: ${guestsError.message}`);
      }

      if (!allGuests || allGuests.length === 0) {
        return [];
      }

      // Récupérer toutes les tables de l'événement
      const { data: tables, error: tablesError } = await supabaseService
        .from('seating_tables')
        .select('id')
        .eq('event_id', eventId);

      if (tablesError) {
        throw new Error(`Error finding tables: ${tablesError.message}`);
      }

      if (!tables || tables.length === 0) {
        // Aucune table = tous les invités non assignés
        return allGuests;
      }

      const tableIds = tables.map(t => t.id);

      // Récupérer toutes les assignations d'invités
      const { data: assignments, error: assignmentsError } = await supabaseService
        .from('table_assignments')
        .select('guest_id')
        .in('table_id', tableIds)
        .not('guest_id', 'is', null);

      if (assignmentsError) {
        // En cas d'erreur, logger mais ne pas faire échouer
        logger.warn('Could not fetch guest assignments:', assignmentsError.message);
        return allGuests; // Retourner tous les invités par sécurité
      }

      const assignedGuestIds = new Set((assignments || []).map(a => a.guest_id).filter(Boolean));
      
      // Filtrer les invités non assignés
      const unassignedGuests = allGuests.filter(guest => !assignedGuestIds.has(guest.id));

      logger.info('Unassigned guests retrieved', {
        eventId,
        userId,
        totalGuests: allGuests.length,
        assignedGuests: assignedGuestIds.size,
        unassignedGuests: unassignedGuests.length
      });

      return unassignedGuests;

    } catch (error) {
      logger.error('Error in seatingTablesDb.getUnassignedGuests:', error);
      throw error;
    }
  },

  /**
   * Récupérer les familles disponibles - VERSION CORRIGÉE
   */
  getAvailableFamilies: async (eventId, userId) => {
    try {
      // Vérifier l'accès à l'événement
      await seatingTablesDb.checkEventAccess(eventId, userId);

      // Récupérer toutes les familles de l'utilisateur
      const { data: families, error: familiesError } = await supabaseService
        .from('families')
        .select('*')
        .eq('user_id', userId);

      if (familiesError) {
        throw new Error(`Error finding families: ${familiesError.message}`);
      }

      if (!families || families.length === 0) {
        return [];
      }

      // Vérifier si les tables de placement existent
      const tablesExist = await seatingTablesDb.checkTablesExist();
      if (!tablesExist) {
        return families; // Toutes les familles disponibles
      }

      // Récupérer les tables de l'événement
      const { data: tables, error: tablesError } = await supabaseService
        .from('seating_tables')
        .select('id')
        .eq('event_id', eventId);

      if (tablesError) {
        logger.warn('Could not fetch tables for family check:', tablesError.message);
        return families; // Retourner toutes les familles par sécurité
      }

      if (!tables || tables.length === 0) {
        return families; // Aucune table = toutes les familles disponibles
      }

      const tableIds = tables.map(t => t.id);

      // Récupérer les assignations de familles
      const { data: assignments, error: assignmentsError } = await supabaseService
        .from('table_assignments')
        .select('family_id')
        .in('table_id', tableIds)
        .not('family_id', 'is', null);

      if (assignmentsError) {
        logger.warn('Could not fetch family assignments:', assignmentsError.message);
        return families; // Retourner toutes les familles par sécurité
      }

      const assignedFamilyIds = new Set((assignments || []).map(a => a.family_id).filter(Boolean));
      
      // Retourner les familles non assignées
      return families.filter(f => !assignedFamilyIds.has(f.id));

    } catch (error) {
      logger.error('Error in seatingTablesDb.getAvailableFamilies:', error);
      throw error;
    }
  },

  // ============================================
  // OPÉRATIONS DE MODIFICATION SÉCURISÉES
  // ============================================

  /**
   * Mettre à jour une table avec validation
   */
  update: async (id, tableData, userId) => {
    try {
      if (!seatingTablesDb.validateUUID(id)) {
        throw new Error('Invalid table ID format');
      }

      // Vérifier l'accès à la table
      const existingTable = await seatingTablesDb.findById(id, userId);
      if (!existingTable) {
        throw new Error('Table not found or access denied');
      }

      // Valider les nouvelles données
      const validationErrors = seatingTablesDb.validateTableData(tableData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Préparer les données à mettre à jour
      const dataToUpdate = {
        name: tableData.name?.trim(),
        seats: tableData.seats,
        table_shape: tableData.table_shape,
        position_x: tableData.position_x,
        position_y: tableData.position_y,
        notes: tableData.notes?.trim() || null,
        updated_at: new Date().toISOString()
      };

      // Nettoyer les valeurs undefined
      Object.keys(dataToUpdate).forEach(key => {
        if (dataToUpdate[key] === undefined) {
          delete dataToUpdate[key];
        }
      });

      const { data, error } = await supabaseService
        .from('seating_tables')
        .update(dataToUpdate)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Error updating seating table: ${error.message}`);
      }

      logger.info('Seating table updated', {
        tableId: id,
        userId,
        changes: Object.keys(dataToUpdate)
      });

      return data;
    } catch (error) {
      logger.error('Error in seatingTablesDb.update:', error);
      throw error;
    }
  },

  /**
   * Supprimer une table avec vérifications de sécurité
   */
  delete: async (id, userId) => {
    try {
      if (!seatingTablesDb.validateUUID(id)) {
        throw new Error('Invalid table ID format');
      }

      // Vérifier l'accès à la table
      const existingTable = await seatingTablesDb.findById(id, userId);
      if (!existingTable) {
        throw new Error('Table not found or access denied');
      }

      // Utiliser une transaction pour supprimer de manière atomique
      const { data, error } = await supabaseService.rpc('exec_sql', {
        query: `
          BEGIN;
          DELETE FROM table_manual_guests WHERE table_id = '${id}';
          DELETE FROM table_assignments WHERE table_id = '${id}';
          DELETE FROM seating_tables WHERE id = '${id}';
          COMMIT;
        `
      });

      if (error) {
        // Fallback : suppression manuelle
        logger.warn('Transaction failed, using manual deletion');
        
        // Supprimer les assignations d'abord
        await supabaseService
          .from('table_assignments')
          .delete()
          .eq('table_id', id);

        // Supprimer les invités manuels
        await supabaseService
          .from('table_manual_guests')
          .delete()
          .eq('table_id', id);

        // Supprimer la table
        const { data: deleteData, error: deleteError } = await supabaseService
          .from('seating_tables')
          .delete()
          .eq('id', id)
          .select()
          .single();

        if (deleteError) {
          throw new Error(`Error deleting seating table: ${deleteError.message}`);
        }

        logger.info('Seating table deleted (manual)', {
          tableId: id,
          userId,
          tableName: existingTable.name
        });

        return deleteData;
      }

      logger.info('Seating table deleted (transaction)', {
        tableId: id,
        userId,
        tableName: existingTable.name
      });

      return existingTable;
    } catch (error) {
      logger.error('Error in seatingTablesDb.delete:', error);
      throw error;
    }
  },

  // ============================================
  // STATISTIQUES SÉCURISÉES
  // ============================================

  /**
   * Récupérer les statistiques des tables
   */
  getStats: async (eventId, userId) => {
    try {
      // Vérifier l'accès à l'événement
      await seatingTablesDb.checkEventAccess(eventId, userId);

      const tablesExist = await seatingTablesDb.checkTablesExist();
      if (!tablesExist) {
        return {
          total_tables: 0,
          total_seats: 0,
          assigned_guests: 0,
          assigned_families: 0,
          available_seats: 0
        };
      }

      const { data: tables, error } = await supabaseService
        .from('seating_tables')
        .select('id, seats')
        .eq('event_id', eventId);

      if (error) {
        throw new Error(`Error getting stats: ${error.message}`);
      }

      if (!tables || tables.length === 0) {
        return {
          total_tables: 0,
          total_seats: 0,
          assigned_guests: 0,
          assigned_families: 0,
          available_seats: 0
        };
      }

      const tableIds = tables.map(t => t.id);
      const totalSeats = tables.reduce((acc, t) => acc + (t.seats || 0), 0);

      // Compter les assignations avec gestion d'erreurs
      let assignedGuests = 0;
      let assignedFamilies = 0;

      try {
        const { data: assignments } = await supabaseService
          .from('table_assignments')
          .select(`
            assignment_type,
            manual_guest_count,
            family:family_id(members)
          `)
          .in('table_id', tableIds);

        if (assignments) {
          assignments.forEach(a => {
            if (a.assignment_type === 'guest') {
              assignedGuests += 1;
            } else if (a.assignment_type === 'family') {
              assignedFamilies += 1;
              assignedGuests += a.family?.members?.length || 1;
            } else if (a.assignment_type === 'manual') {
              assignedGuests += a.manual_guest_count || 1;
            }
          });
        }

        // Compter les invités manuels
        const { data: manualGuests } = await supabaseService
          .from('table_manual_guests')
          .select('id')
          .in('table_id', tableIds);

        assignedGuests += manualGuests?.length || 0;

      } catch (error) {
        logger.warn('Could not fetch assignment stats:', error.message);
      }

      const stats = {
        total_tables: tables.length,
        total_seats: totalSeats,
        assigned_guests: Math.max(0, assignedGuests),
        assigned_families: Math.max(0, assignedFamilies),
        available_seats: Math.max(0, totalSeats - assignedGuests)
      };

      logger.info('Seating stats retrieved', {
        eventId,
        userId,
        stats
      });

      return stats;
    } catch (error) {
      logger.error('Error in seatingTablesDb.getStats:', error);
      throw error;
    }
  }
};

module.exports = seatingTablesDb;