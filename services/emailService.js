const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
this.transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});



    this.batchSize = parseInt(process.env.EMAIL_BATCH_SIZE) || 10;
    this.batchDelay = parseInt(process.env.BATCH_DELAY_MS) || 1000;

    this.sender = `"${process.env.FROM_NAME}" <${process.env.EMAIL_USER}>`
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified successfully');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }

  async sendEmail(mailOptions) {
    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully to: ${mailOptions.to}`);
      return info;
    } catch (error) {
      logger.error(`Failed to send email to ${mailOptions.to}:`, error.message);
      throw error;
    }
  }

  async sendBulkEmails({ sender, subject, body, receivers, onProgress }) {
    const results = {
      successful: [],
      failed: [],
      total: receivers.length
    };

    let processed = 0;

    for (let i = 0; i < receivers.length; i += this.batchSize) {
      const batch = receivers.slice(i, i + this.batchSize);
      
      const batchPromises = batch.map(async (receiver) => {
        try {
          const mailOptions = {
            from: sender,
            to: receiver,
            subject: subject,
            html: body,
            text: this.stripHtml(body)
          };

          const info = await this.sendEmail(mailOptions);
          
          const successResult = {
            email: receiver,
            messageId: info.messageId,
            status: 'sent',
            timestamp: new Date()
          };
          
          results.successful.push(successResult);
          processed++;

          if (onProgress) {
            onProgress({
              processed,
              successful: results.successful.length,
              failed: results.failed.length,
              results: [...results.successful, ...results.failed]
            });
          }

          return successResult;
          
        } catch (error) {
          const failResult = {
            email: receiver,
            error: error.message,
            status: 'failed',
            timestamp: new Date()
          };
          
          results.failed.push(failResult);
          processed++;

          if (onProgress) {
            onProgress({
              processed,
              successful: results.successful.length,
              failed: results.failed.length,
              results: [...results.successful, ...results.failed]
            });
          }

          return failResult;
        }
      });

      await Promise.all(batchPromises);

      if (i + this.batchSize < receivers.length) {
        await this.delay(this.batchDelay);
      }
    }

    logger.info(`Bulk email completed: ${results.successful.length}/${results.total} successful`);
    return results;
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const emailService = new EmailService();
emailService.verifyConnection();
module.exports = emailService;
