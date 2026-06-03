const { Kafka } = require('kafkajs');
const repo = require('../repository/retail-repo'); // make sure this points to your repo file
const net = require('net');

const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

const kafka = new Kafka({
  clientId: "restaurant-service",
  brokers: [KAFKA_BROKER], // Local Kafka broker
});

const consumer = kafka.consumer({ groupId: "restaurant-group" });

/**
 * Wait until Kafka broker is reachable
 */
const waitForKafka = async (host = KAFKA_BROKER.split(':')[0], port = parseInt(KAFKA_BROKER.split(':')[1])) => {
  return new Promise((resolve) => {
    const client = new net.Socket();

    const tryConnect = () => {
      client.connect(port, host, () => {
        client.destroy();
        resolve();
      });

      client.on('error', () => {
        setTimeout(tryConnect, 1000); // retry every 1 second
      });
    };

    tryConnect();
  });
};

/**
 * Start the consumer to listen to restaurant-topic
 */
const consumeEvents = async () => {
  await waitForKafka(); // ensure Kafka is up before connecting

  try {
    await consumer.connect();
    console.log('🟢 Restaurant consumer connected to Kafka');

    await consumer.subscribe({ topic: "restaurant-topic", fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          const eventId = message.key?.toString() || `${partition}-${message.offset}`;

          // Skip duplicate events
          if (await repo.isEventProcessed(eventId)) {
            console.log('⏩ Skipping duplicate event', eventId);
            return;
          }

          // Insert company data into DB
          await repo.createCompany({
            zodu_id: payload.zodu_id,
            owner_admin_name: payload.owner_admin_name,
            restaurant_name: payload.restaurant_name,
            mobile_no: payload.phone_number,
            mail_id: payload.email,
            gst_no: payload.gst_no,
            pincode: payload.pincode,
            city: payload.city,
            district: payload.district,
            state: payload.state,
            address_line_1: payload.address_line_1 ?? payload.building_no,
            address_line_2: payload.address_line_2 ?? payload.area_street_name,
            account_number: payload.account_number,
            account_type: payload.account_type,
            ifsc_code: payload.ifsc_code
          });

          // Mark event as processed
          await repo.markEventProcessed({
            eventId,
            topic,
            partition,
            offset: parseInt(message.offset, 10)
          });

          console.log('✅ Processed company', payload.zodu_id);

        } catch (err) {
          console.error('❌ Error processing message', err);
        }
      }
    });

  } catch (err) {
    console.error('⚠️ Consumer error, retrying in 3s...', err);
    setTimeout(consumeEvents, 3000); // Retry on failure
  }
};

module.exports = { consumeEvents };
