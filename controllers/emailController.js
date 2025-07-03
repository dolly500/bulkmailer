const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// In-memory storage for email status (use database in production)
const emailStatusStore = new Map();

//force sender from environment
const DEFAULT_SENDER = `"${process.env.FROM_NAME}" <${process.env.EMAIL_USER}>`

const sendBulkEmail = async (req, res) => {
  try {
    const { sender, subject, body, receivers } = req.body;
    const requestId = uuidv4();
    
    logger.info(`Bulk email request initiated: ${requestId} for ${receivers.length} recipients`);
    
    // Initialize status tracking
    emailStatusStore.set(requestId, {
      status: 'processing',
      total: receivers.length,
      processed: 0,
      successful: 0,
      failed: 0,
      startTime: new Date(),
      results: []
    });

    // Send immediate response with request ID
    res.status(202).json({
      message: 'Bulk email processing started',
      requestId: requestId,
      totalRecipients: receivers.length,
      statusUrl: `/api/email-status/${requestId}`
    });

    // Process emails asynchronously
    processEmailsAsync(requestId, { sender, subject, body, receivers });

  } catch (error) {
    logger.error('Bulk email controller error:', error);
    res.status(500).json({
      error: 'Internal server error while initiating bulk email',
      message: error.message
    });
  }
};

const sendSingleEmail = async (req, res) => {
  try {
    const { sender, receiver, subject, body } = req.body;
    
    // Validate single email request
    if (!sender || !receiver || !subject || !body) {
      return res.status(400).json({
        error: 'Missing required fields: sender, receiver, subject, body'
      });
    }

    const result = await emailService.sendEmail({
      from: DEFAULT_SENDER,
      to: receiver,
      subject: subject,
      html: body,
      text: body.replace(/<[^>]*>/g, '')
    });

    res.status(200).json({
      message: 'Email sent successfully',
      messageId: result.messageId,
      recipient: receiver
    });

  } catch (error) {
    logger.error('Single email error:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
};

const getEmailStatus = (req, res) => {
  const { requestId } = req.params;
  
  const status = emailStatusStore.get(requestId);
  
  if (!status) {
    return res.status(404).json({
      error: 'Email request not found',
      requestId: requestId
    });
  }

  res.status(200).json({
    requestId: requestId,
    ...status
  });
};

// Async function to process emails in background
async function processEmailsAsync(requestId, emailData) {
  const { sender, subject, body, receivers } = emailData;
  const status = emailStatusStore.get(requestId);
  
  try {
    const results = await emailService.sendBulkEmails({
      sender: DEFAULT_SENDER,
      subject,
      body,
      receivers,
      onProgress: (progress) => {
        // Update status in real-time
        const currentStatus = emailStatusStore.get(requestId);
        if (currentStatus) {
          emailStatusStore.set(requestId, {
            ...currentStatus,
            processed: progress.processed,
            successful: progress.successful,
            failed: progress.failed,
            results: progress.results
          });
        }
      }
    });

    // Mark as completed
    emailStatusStore.set(requestId, {
      ...status,
      status: 'completed',
      processed: results.total,
      successful: results.successful.length,
      failed: results.failed.length,
      results: [...results.successful, ...results.failed],
      completedTime: new Date()
    });

    logger.info(`Bulk email completed: ${requestId} - ${results.successful.length}/${results.total} successful`);

  } catch (error) {
    logger.error(`Bulk email processing failed: ${requestId}`, error);
    
    emailStatusStore.set(requestId, {
      ...status,
      status: 'error',
      error: error.message,
      completedTime: new Date()
    });
  }
}

module.exports = {
  sendBulkEmail,
  sendSingleEmail,
  getEmailStatus
};