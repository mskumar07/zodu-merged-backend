// src/services/notificationService.js
const notificationRepo = require('../repositories/notificationRepo');
const { publish } = require('../kafka/producer');

const enqueueNotification = async ({ user_id = null, checklist_instance_id = null, channel = 'inapp', payload = {} }) => {
  // push to Kafka topic for async processing (workers will write to DB and send)
  const message = { user_id, checklist_instance_id, channel, payload };
  await publish(process.env.KAFKA_TOPIC_NOTIFICATION || 'notification.enqueue', message);
  return { queued: true };
};

const listNotificationsByInstance = async (checklist_instance_id) => notificationRepo.listByInstance(checklist_instance_id);

module.exports = { enqueueNotification, listNotificationsByInstance };
