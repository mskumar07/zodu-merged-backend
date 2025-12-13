// src/workers/notificationWorker.js
const { createConsumer } = require('../kafka/consumer');
const notificationRepo = require('../repositories/notificationRepo');

const TOPIC = process.env.KAFKA_TOPIC_NOTIFICATION || 'notification.enqueue';
const GROUP = process.env.KAFKA_GROUP_NOTIFICATION || 'notification-worker';

async function run() {
  const consumer = createConsumer(GROUP);
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  console.log('NotificationWorker subscribed to', TOPIC);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        // payload: { user_id, checklist_instance_id, channel, payload }
        await notificationRepo.create(payload);
        console.log('Enqueued notification saved to DB for', payload.user_id || '(broadcast)');
        // extend here to call external push/sms providers
      } catch (err) {
        console.error('notificationWorker error', err);
      }
    }
  });
}

module.exports = { run };
