const cron = require('node-cron');
const { logger } = require('../config/logger');
const BatchProcessor = require('./batch.service');

class SchedulerService {
    static jobs = new Map();
  
    static init() {
    // Process pending URLs every 30 seconds in production, 10 seconds in development
    const urlInterval = process.env.NODE_ENV === 'production' ? '*/30 * * * * *' : '*/10 * * * * *';
    
    // Store job reference for management
    this.jobs.set('processPendingUrls', cron.schedule(urlInterval, async () => {
        try {
          await BatchProcessor.processPendingUrls();
        } catch (error) {
          logger.error('Failed to process pending URLs:', error);
        }
      }, {
        scheduled: true,
        timezone: "UTC"  // Explicitly set timezone
      }));

    // Sync analytics every 10 seconds
    // this.jobs.set('processAnalytics', cron.schedule('*/10 * * * * *', async () => {
    //   try {
    //     await BatchProcessor.processAnalytics();
    //   } catch (error) {
    //     logger.error('Failed to process analytics:', error);
    //   }
    // }, {
    //   scheduled: true,
    //   timezone: "UTC"
    // }));

    // Clean up expired data daily
    this.jobs.set('cleanup', cron.schedule('0 0 * * *', async () => {
      try {
        await this.cleanup();
      } catch (error) {
        logger.error('Failed to cleanup:', error);
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    }));
      
    // Sync Redis counters to PostgreSQL every hour
    // this.jobs.set('syncCounters', cron.schedule('0 * * * *', async () => {
    //   try {
    //     await BatchProcessor.syncCounters();
    //   } catch (error) {
    //     logger.error('Failed to sync counters:', error);
    //   }
    // }, {
    //   scheduled: true,
    //   timezone: "UTC"
    // }));
    }
    
    static stopAll() {
        for (const [name, job] of this.jobs) {
          logger.info(`Stopping cron job: ${name}`);
          job.stop();
        }
      }
    
      static startAll() {
        for (const [name, job] of this.jobs) {
          logger.info(`Starting cron job: ${name}`);
          job.start();
        }
      }
}

module.exports = SchedulerService;