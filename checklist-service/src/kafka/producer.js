// src/kafka/producer.js
const { Kafka } = require('kafkajs');
require('dotenv').config();

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'checklist-app',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const producer = kafka.producer();

async function initProducer() {
  await producer.connect();
  console.log('Kafka producer connected');
}

async function publish(topic, message) {
  if (!producer) throw new Error('Producer not initialized');
  const payload = {
    topic,
    messages: [{ value: JSON.stringify(message) }]
  };
  await producer.send(payload);
}

module.exports = { initProducer, publish };
