const { Kafka } = require('kafkajs');

const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';


const kafka = new Kafka({
  clientId: "auth-service",
  brokers: [KAFKA_BROKER], // Local Kafka broker
});

const consumer = kafka.consumer({ groupId: "auth-group" });
const producer = kafka.producer();

/**
 * Start the consumer to listen to auth-topic
 */
// const consumeEvents = async () => {
//   await consumer.connect();
//   await consumer.subscribe({ topic: "auth-topic", fromBeginning: true });

//   await consumer.run({
//     eachMessage: async ({ topic, partition, message }) => {
//       console.log("📩 Auth Service received event:", message.value.toString());
//     },
//   });
// };

/**
 * Connect producer
 */
// async function connectProducer() {
//   await producer.connect();
//   console.log('✅ Auth Kafka producer connected');
// }

/**
 * Publish account creation event to restaurant-topic
 */
// async function publishAccountCreated(payload) {
//   await producer.send({
//     topic: "restaurant-topic",
//     messages: [{ key: payload.zodu_id, value: JSON.stringify(payload) }]
//   });
// }

// module.exports = { consumeEvents, };
