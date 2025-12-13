// src/kafka/consumer.js
const { Kafka } = require('kafkajs');
require('dotenv').config();

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'checklist-app',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

function createConsumer(groupId) {
  return kafka.consumer({ groupId: groupId || 'checklist-group' });
}

module.exports = { createConsumer };
