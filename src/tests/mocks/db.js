const { Pool } = require('pg');

class MockPool {
  constructor() {
    this.initializeTables();
  }

  initializeTables() {
    // Initialize empty tables
    this.tables = {
      users: [],
      urls: [],
      visits: [],
      analytics: []
    };
  }

  clearTables() {
    this.initializeTables();
  }

  async query(text, params = []) {
    try {
      // Parse the query
      const normalizedQuery = text.toLowerCase().trim();
      
      if (normalizedQuery.startsWith('insert into')) {
        return this._handleInsert(text, params);
      } else if (normalizedQuery.startsWith('select')) {
        return this._handleSelect(text, params);
      } else if (normalizedQuery.startsWith('update')) {
        return this._handleUpdate(text, params);
      }
      
      return { rows: [] };
    } catch (error) {
      console.error('Mock DB Error:', error);
      throw error;
    }
  }

  _handleInsert(text, params) {
    const match = text.match(/insert into (\w+)/i);
    if (!match) return { rows: [] };
    
    const tableName = match[1].toLowerCase();
    const now = new Date().toISOString();
    
    // Ensure table exists
    if (!this.tables[tableName]) {
      this.tables[tableName] = [];
    }

    // Extract column names
    const columnMatch = text.match(/\((.*?)\)/);
    if (!columnMatch) return { rows: [] };
    
    const columns = columnMatch[1].split(',').map(c => c.trim());
    
    let newRow = {
      id: this.tables[tableName].length > 0 
        ? Math.max(...this.tables[tableName].map(row => row.id)) + 1 
        : 1,
      created_at: now,
      updated_at: now
    };

    // Map parameters to column names
    columns.forEach((col, index) => {
      newRow[col] = params[index];
    });

    // Add timestamps and handle special cases for specific tables
    if (tableName === 'urls') {
      newRow.last_accessed = now;
    }
    if (tableName === 'visits') {
      newRow.visited_at = now;
      // If url_id not provided directly, try to find it from short_url
      if (!newRow.url_id) {
        const shortUrl = params[0];
        const url = this.tables.urls.find(u => u.short_url === shortUrl);
        if (url) {
          newRow.url_id = url.id;
        }
      }
    }

    this.tables[tableName].push(newRow);
    return { rows: [newRow] };
  }

  _handleSelect(text, params) {
    const normalizedQuery = text.toLowerCase();
    
    // Handle analytics queries
    if (normalizedQuery.includes('count(')) {
      return this._handleAnalyticsQuery(text, params);
    }

    // Extract table name
    const tableMatch = text.match(/from\s+(\w+)/i);
    if (!tableMatch) return { rows: [] };
    
    const tableName = tableMatch[1].toLowerCase();
    
    // Ensure table exists
    if (!this.tables[tableName]) {
      this.tables[tableName] = [];
    }
    
    let results = [...this.tables[tableName]];

    // Apply where conditions
    if (normalizedQuery.includes('where')) {
      results = this._applyWhereConditions(results, text, params);
    }

    // Handle joins if present
    if (normalizedQuery.includes('join')) {
      results = this._handleJoins(text, results, params);
    }

    return { rows: results };
  }

  _handleJoins(text, results, params) {
    const normalizedQuery = text.toLowerCase();
    const joinMatches = text.match(/join\s+(\w+)\s+on\s+(.*?)(?=\s+(?:where|group|order|$))/gi);
    
    if (!joinMatches) return results;

    joinMatches.forEach(joinClause => {
      const [_, tableName, condition] = joinClause.match(/join\s+(\w+)\s+on\s+(.*)/i);
      const joinTable = this.tables[tableName.toLowerCase()];
      
      if (!joinTable) return;

      results = results.map(row => {
        const matches = joinTable.filter(joinRow => {
          const [leftSide, rightSide] = condition.split('=').map(s => s.trim());
          const leftValue = this._resolveColumnValue(row, leftSide);
          const rightValue = this._resolveColumnValue(joinRow, rightSide);
          return leftValue === rightValue;
        });
        return matches.length ? { ...row, ...matches[0] } : row;
      });
    });

    return results;
  }

  _resolveColumnValue(row, columnRef) {
    const parts = columnRef.split('.');
    return parts.length === 2 ? row[parts[1]] : row[columnRef];
  }

  _handleAnalyticsQuery(text, params) {
    const normalizedQuery = text.toLowerCase();
    const whereMatch = text.match(/where\s+(.*?)(?:\s+group\s+by|\s*$)/i);
    const whereConditions = whereMatch ? whereMatch[1] : '';
    
    // First get the URL ID if we're filtering by short_url
    let urlId;
    if (whereConditions.includes('short_url')) {
      const shortUrl = params[0];
      const url = this.tables.urls.find(u => u.short_url === shortUrl);
      urlId = url ? url.id : -1;
    }
    
    let visits = [...this.tables.visits];
    
    // Filter visits by URL ID if needed
    if (urlId !== undefined) {
      visits = visits.filter(v => v.url_id === urlId);
    }
    
    // Apply other where conditions
    if (whereConditions && !whereConditions.includes('short_url')) {
      visits = this._applyWhereConditions(visits, `SELECT * FROM visits WHERE ${whereConditions}`, params);
    }
    
    if (normalizedQuery.includes('count(distinct visitor_ip)')) {
      const uniqueUsers = new Set(visits.map(v => v.visitor_ip)).size;
      return { rows: [{ count: uniqueUsers }] };
    } 
    
    if (normalizedQuery.includes('count(*)')) {
      return { rows: [{ count: visits.length }] };
    }
    
    if (normalizedQuery.includes('group by')) {
      return this._handleGroupedAnalytics(text, visits);
    }

    return { rows: visits };
  }

  _handleGroupedAnalytics(text, visits) {
    const normalizedQuery = text.toLowerCase();
    
    if (normalizedQuery.includes('device_type')) {
      const deviceStats = {};
      visits.forEach(visit => {
        const deviceType = visit.device_type.toLowerCase();
        deviceStats[deviceType] = (deviceStats[deviceType] || 0) + 1;
      });
      
      return { rows: Object.entries(deviceStats).map(([deviceName, count]) => ({
        deviceName,
        uniqueClicks: count,
        uniqueUsers: new Set(visits.filter(v => v.device_type.toLowerCase() === deviceName).map(v => v.visitor_ip)).size
      })) };
    }
    
    if (normalizedQuery.includes('os_type')) {
      const osStats = {};
      visits.forEach(visit => {
        const osType = visit.os_type.toLowerCase();
        osStats[osType] = (osStats[osType] || 0) + 1;
      });
      
      return { rows: Object.entries(osStats).map(([osName, count]) => ({
        osName,
        uniqueClicks: count,
        uniqueUsers: new Set(visits.filter(v => v.os_type.toLowerCase() === osName).map(v => v.visitor_ip)).size
      })) };
    }
    
    if (normalizedQuery.includes('date(visited_at)')) {
      const dateStats = {};
      visits.forEach(visit => {
        const date = visit.visited_at.split('T')[0];
        dateStats[date] = (dateStats[date] || 0) + 1;
      });
      
      return { rows: Object.entries(dateStats).map(([date, clicks]) => ({
        date,
        clicks
      })) };
    }
    
    return { rows: [] };
  }

  _handleUpdate(text, params) {
    const match = text.match(/update (\w+)/i);
    if (!match) return { rows: [] };
    
    const tableName = match[1].toLowerCase();
    const now = new Date().toISOString();
    
    // Extract where conditions
    const whereMatch = text.match(/where\s+(.*?)$/i);
    if (!whereMatch) return { rows: [] };
    
    const whereConditions = whereMatch[1];
    const rows = this.tables[tableName];
    let rowIndex = -1;

    // Find the row to update
    if (whereConditions.includes('id =')) {
      rowIndex = rows.findIndex(row => row.id === params[params.length - 1]);
    } else if (whereConditions.includes('short_url =')) {
      rowIndex = rows.findIndex(row => row.short_url === params[params.length - 1]);
    }
    
    if (rowIndex === -1) return { rows: [] };
    
    // Update the row
    const updatedRow = { ...rows[rowIndex] };
    updatedRow.updated_at = now;
    
    if (tableName === 'urls') {
      updatedRow.last_accessed = now;
    }
    
    // Extract and apply updates
    const setClause = text.match(/set (.*?) where/i)[1];
    const updates = setClause.split(',').map(update => update.trim());
    
    updates.forEach((update, index) => {
      const [column] = update.split('=').map(s => s.trim());
      updatedRow[column] = params[index];
    });
    
    rows[rowIndex] = updatedRow;
    return { rows: [updatedRow] };
  }

  _applyWhereConditions(results, text, params) {
    const whereMatch = text.match(/where (.*?)(?:$|\s+(?:group by|order by|limit))/i);
    if (!whereMatch) return results;
    
    const whereClause = whereMatch[1];
    const conditions = whereClause.split('and').map(c => c.trim());
    
    return results.filter(row => {
      return conditions.every((condition, index) => {
        if (condition.includes('=')) {
          const [column] = condition.split('=').map(s => s.trim());
          const columnName = column.includes('.') ? column.split('.')[1] : column;
          return row[columnName] === params[index];
        }
        return true;
      });
    });
  }
}

const mockPool = new MockPool();

function mockDatabase() {
  const mockQuery = jest.fn().mockImplementation((...args) => mockPool.query(...args));
  jest.spyOn(Pool.prototype, 'query').mockImplementation(mockQuery);
  return mockPool;
}

module.exports = {
  mockPool,
  mockDatabase
}; 