// src/workers/cloneTasksWorker.js
const { createConsumer } = require('../kafka/consumer');
const db = require('../database/connection');

const TOPIC = process.env.KAFKA_TOPIC_CHK_INST_CREATED || 'checklist-instance.created';
const GROUP = process.env.KAFKA_GROUP_CLONE || 'clone-tasks-worker';

async function run() {
  const consumer = createConsumer(GROUP);
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  console.log('CloneTasksWorker subscribed to', TOPIC);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        const { checklist_instance_id, checklist_id } = payload;

        if (!checklist_instance_id || !checklist_id) {
          console.warn('Invalid payload for cloning:', payload);
          return;
        }

        // Clone tasks for checklist into task_instance (same logic as previous trigger)
        const q = `
          INSERT INTO tbl_task_instance (checklist_instance_id, task_id, status, payload, created_at)
          SELECT $1 AS checklist_instance_id, t.id AS task_id, 'pending'::text AS status,
                 jsonb_build_object(
                   'title', t.title,
                   'description', t.description,
                   'reference_image_url', t.reference_image_url,
                   'voice_url', t.voice_url,
                   'task_template_created_at', t.created_at
                 ) AS payload,
                 now() AS created_at
          FROM tbl_task t
          WHERE t.checklist_id = $2
            AND t.enabled = TRUE
          ORDER BY t.created_at
          RETURNING id;
        `;

        const res = await db.query(q, [checklist_instance_id, checklist_id]);
        console.log(`Cloned ${res.rowCount} tasks for checklist_instance_id=${checklist_instance_id}`);
      } catch (err) {
        console.error('Error in cloneTasksWorker:', err);
        // optionally send to DLQ topic or log for retry
      }
    }
  });
}

module.exports = { run };
